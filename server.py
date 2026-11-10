#!/usr/bin/env python3
"""
LINE Automation Bridge Server (安全讀取與速率保護版)
功能：
1. 即時被動接收訊息 (內建最近訊息快取與可選 Webhook 推播)
2. 查詢歷史即時訊息 (GET /api/messages)
3. 嚴格發話速率節流 (Rate Limiting)
4. 訊息收回 (POST /api/unsend)
"""

import asyncio
import collections
import json
import os
import time
import uuid
import logging
from aiohttp import web, WSMsgType, ClientSession

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("LineBridge")

active_ws_clients = set()
pending_requests = {}

# 儲存最近收到的 200 則訊息 (被動讀取，不佔硬碟)
recent_messages = collections.deque(maxlen=200)

# 發話速率保護器：最後發話時間 (秒)
last_send_time = 0.0
MIN_SEND_INTERVAL_SEC = 3.0  # 兩次發送之間至少冷卻 3 秒

# 可選 Webhook 網址 (收到新訊息時自動推播給外部後端)
WEBHOOK_URL = os.environ.get("LINE_WEBHOOK_URL", "").strip()


async def forward_to_webhook(message_data):
    """若有設定 WEBHOOK_URL，將新收到的訊息即時推播至外部網站後端"""
    if not WEBHOOK_URL:
        return
    try:
        async with ClientSession() as session:
            async with session.post(WEBHOOK_URL, json=message_data, timeout=5.0) as resp:
                if resp.status != 200:
                    logger.warning(f"Webhook forward returned HTTP {resp.status}")
    except Exception as e:
        logger.error(f"Failed to forward to webhook: {e}")


async def ws_handler(request):
    """處理來自 LINE Chrome 擴充功能的 WebSocket 連線"""
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    active_ws_clients.add(ws)
    logger.info("LINE Extension client connected via WebSocket.")

    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    msg_type = data.get("type")
                    req_id = data.get("id")

                    # 1. 被動新訊息推播事件
                    if msg_type == "new_message":
                        message_item = data.get("data", {})
                        recent_messages.append(message_item)
                        logger.info(f"📩 收到新訊息 [{message_item.get('chatName')}] {message_item.get('senderName')}: {message_item.get('text')}")
                        # 異步觸發 Webhook
                        asyncio.create_task(forward_to_webhook(message_item))
                        continue

                    if msg_type == "ready":
                        logger.info("LINE Extension hook is READY and active!")
                        continue

                    # 2. 請求回應配對
                    if req_id and req_id in pending_requests:
                        future = pending_requests[req_id]
                        if not future.done():
                            future.set_result(data)
                except Exception as e:
                    logger.error(f"Error handling WebSocket message: {e}")
            elif msg.type == WSMsgType.ERROR:
                logger.error(f"WebSocket closed with exception: {ws.exception()}")
    finally:
        active_ws_clients.discard(ws)
        logger.warning("LINE Extension client disconnected.")

    return ws


async def handle_status(request):
    """檢查擴充功能在線狀態與接收計數"""
    is_online = len(active_ws_clients) > 0
    return web.json_response({
        "status": "online" if is_online else "offline",
        "connected_clients": len(active_ws_clients),
        "cached_messages_count": len(recent_messages),
        "rate_limit_interval_sec": MIN_SEND_INTERVAL_SEC
    })


async def handle_get_messages(request):
    """
    查詢最近接收到的訊息 API
    GET /api/messages?limit=20&chatId=...
    """
    limit = int(request.query.get("limit", 50))
    chat_id = request.query.get("chatId", "").strip()

    messages_list = list(recent_messages)
    if chat_id:
        messages_list = [m for m in messages_list if m.get("chatId") == chat_id]

    # 取最新的 N 筆
    result = messages_list[-limit:]
    return web.json_response({
        "success": True,
        "count": len(result),
        "messages": result
    })


async def handle_send(request):
    """
    發送訊息 API (具備強制速率冷卻)
    POST /api/send
    """
    global last_send_time

    if not active_ws_clients:
        return web.json_response({
            "success": False,
            "error": "LINE 擴充功能尚未連線，請確認 LINE 視窗已開啟且已登入。"
        }, status=503)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "無效的 JSON 請求體"}, status=400)

    target = body.get("target")
    message = body.get("message")
    timeout = float(body.get("timeout", 15.0))

    if not target or not message:
        return web.json_response({"success": False, "error": "缺少 'target' 或 'message' 參數"}, status=400)

    # 伺服器端強制速率冷卻，防止發話頻率過高觸發風控
    now = time.time()
    elapsed = now - last_send_time
    if elapsed < MIN_SEND_INTERVAL_SEC:
        wait_sec = MIN_SEND_INTERVAL_SEC - elapsed
        logger.info(f"Rate limiting: cooling down for {wait_sec:.2f}s before sending...")
        await asyncio.sleep(wait_sec)

    options = {}
    if body.get("mention"):
        options["mention"] = body.get("mention")
    if body.get("mentionMid"):
        options["mentionMid"] = body.get("mentionMid")
        options["mentionName"] = body.get("mentionName", "成員")

    req_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_requests[req_id] = future

    payload = json.dumps({
        "id": req_id,
        "action": "send",
        "target": target,
        "message": message,
        "options": options
    })

    logger.info(f"Dispatching send: target='{target}', message='{message}'")
    for client in list(active_ws_clients):
        await client.send_str(payload)

    last_send_time = time.time()

    try:
        response = await asyncio.wait_for(future, timeout=timeout)
        if response.get("status") == "success":
            return web.json_response({
                "success": True,
                "target": target,
                "message": message,
                "detail": response.get("result")
            })
        else:
            return web.json_response({
                "success": False,
                "error": response.get("error", "發送失敗")
            }, status=500)
    except asyncio.TimeoutError:
        return web.json_response({"success": False, "error": "發送操作逾時"}, status=504)
    finally:
        pending_requests.pop(req_id, None)


async def handle_unsend(request):
    """收回訊息 API"""
    if not active_ws_clients:
        return web.json_response({"success": False, "error": "擴充功能未連線"}, status=503)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "無效的 JSON"}, status=400)

    target = body.get("target")
    message_id = body.get("messageId")
    timeout = float(body.get("timeout", 10.0))

    if not target or not message_id:
        return web.json_response({"success": False, "error": "缺少 'target' 或 'messageId'"}, status=400)

    req_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_requests[req_id] = future

    payload = json.dumps({
        "id": req_id,
        "action": "unsend",
        "target": target,
        "messageId": str(message_id)
    })

    for client in list(active_ws_clients):
        await client.send_str(payload)

    try:
        response = await asyncio.wait_for(future, timeout=timeout)
        if response.get("status") == "success":
            return web.json_response({
                "success": True,
                "target": target,
                "messageId": message_id,
                "detail": response.get("result")
            })
        else:
            return web.json_response({"success": False, "error": response.get("error", "收回失敗")}, status=500)
    except asyncio.TimeoutError:
        return web.json_response({"success": False, "error": "收回操作逾時"}, status=504)
    finally:
        pending_requests.pop(req_id, None)


async def handle_chats(request):
    """查詢所有聊天室清單與 MID"""
    if not active_ws_clients:
        return web.json_response({"success": False, "error": "擴充功能未連線"}, status=503)

    req_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_requests[req_id] = future

    payload = json.dumps({"id": req_id, "action": "list_chats"})
    for client in list(active_ws_clients):
        await client.send_str(payload)

    try:
        response = await asyncio.wait_for(future, timeout=5.0)
        return web.json_response({"success": True, "chats": response.get("chats", [])})
    except asyncio.TimeoutError:
        return web.json_response({"success": False, "error": "逾時"}, status=504)
    finally:
        pending_requests.pop(req_id, None)


def create_app():
    app = web.Application()

    @web.middleware
    async def cors_middleware(request, handler):
        if request.method == "OPTIONS":
            resp = web.Response()
        else:
            resp = await handler(request)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return resp

    app.middlewares.append(cors_middleware)

    app.router.add_get("/", ws_handler)
    app.router.add_get("/api/status", handle_status)
    app.router.add_get("/api/messages", handle_get_messages)
    app.router.add_post("/api/send", handle_send)
    app.router.add_post("/api/unsend", handle_unsend)
    app.router.add_get("/api/chats", handle_chats)

    return app


if __name__ == "__main__":
    PORT = 8989
    logger.info(f"Starting LINE Bridge Server (Safe Rate & Listener) on http://127.0.0.1:{PORT}")
    app = create_app()
    web.run_app(app, host="127.0.0.1", port=PORT)
