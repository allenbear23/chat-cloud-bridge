#!/usr/bin/env python3
"""
LINE Automation Bridge Server (精進版)
支援：
- 發送訊息 (支援普通訊息、@All 全體標記、@指定成員標記)
- 收回訊息 (Unsend Message)
- 查詢聊天室清單與 MID
"""

import asyncio
import json
import uuid
import logging
from aiohttp import web, WSMsgType

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("LineBridge")

active_ws_clients = set()
pending_requests = {}


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
                    req_id = data.get("id")

                    if data.get("type") == "ready":
                        logger.info("LINE Extension hook is READY and active!")
                        continue

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
    """檢查擴充功能在線狀態"""
    is_online = len(active_ws_clients) > 0
    return web.json_response({
        "status": "online" if is_online else "offline",
        "connected_clients": len(active_ws_clients)
    })


async def handle_send(request):
    """
    發送訊息 API (支援 Mention)
    POST /api/send
    Body:
    {
      "target": "群組名稱或MID",
      "message": "訊息文字",
      "mention": "all",              // 選填：設為 "all" 即標記 @All 全體
      "mentionMid": "u...",          // 選填：標記特定使用者的 MID
      "mentionName": "小明",         // 選填：標記顯示名稱
      "timeout": 15
    }
    """
    if not active_ws_clients:
        return web.json_response({
            "success": False,
            "error": "LINE Chrome 擴充功能尚未連線，請確認擴充功能視窗已開啟且已登入。"
        }, status=503)

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "無效的 JSON 請求體"}, status=400)

    target = body.get("target")
    message = body.get("message")
    timeout = float(body.get("timeout", 15.0))

    if not target or not message:
        return web.json_response({
            "success": False,
            "error": "缺少 'target' 或 'message' 參數"
        }, status=400)

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

    logger.info(f"Dispatching send command: target='{target}', message='{message}', options={options}")
    for client in list(active_ws_clients):
        await client.send_str(payload)

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
        return web.json_response({
            "success": False,
            "error": f"發送操作逾時 ({timeout} 秒)"
        }, status=504)
    finally:
        pending_requests.pop(req_id, None)


async def handle_unsend(request):
    """
    收回訊息 API
    POST /api/unsend
    Body:
    {
      "target": "群組名稱或MID",
      "messageId": "訊息序號ID",
      "timeout": 10
    }
    """
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
        return web.json_response({"success": False, "error": "缺少 'target' 或 'messageId' 參數"}, status=400)

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

    logger.info(f"Dispatching unsend command: target='{target}', messageId='{message_id}'")
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
            return web.json_response({
                "success": False,
                "error": response.get("error", "收回失敗")
            }, status=500)
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
        return web.json_response({
            "success": True,
            "chats": response.get("chats", [])
        })
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
    app.router.add_post("/api/send", handle_send)
    app.router.add_post("/api/unsend", handle_unsend)
    app.router.add_get("/api/chats", handle_chats)

    return app


if __name__ == "__main__":
    PORT = 8989
    logger.info(f"Starting LINE Bridge Server on http://127.0.0.1:{PORT}")
    app = create_app()
    web.run_app(app, host="127.0.0.1", port=PORT)
