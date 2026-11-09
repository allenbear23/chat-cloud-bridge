#!/usr/bin/env python3
"""
LINE Automation Bridge Server
提供 HTTP REST API 供外部/網站後端呼叫，並透過 WebSocket 指示 LINE Chrome 擴充功能發送訊息。
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

# 保存已連線的擴充功能 WebSocket
active_ws_clients = set()
# 等待回應的請求：req_id -> asyncio.Future
pending_requests = {}


async def ws_handler(request):
    """處理來自 LINE Chrome 擴充功能 hook.js 的 WebSocket 連線"""
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

                    # 若收到客戶端 ready 宣告
                    if data.get("type") == "ready":
                        logger.info("LINE Extension hook is READY and active!")
                        continue

                    # 若是正在等待的請求回應
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
    發送訊息 API
    POST /api/send
    Body: {"target": "群組名稱", "message": "訊息文字", "timeout": 15}
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
            "error": "缺少 'target' (群組/聊天室名稱) 或 'message' (訊息內容) 參數"
        }, status=400)

    req_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_requests[req_id] = future

    # 廣播至所有已連接的 LINE 視窗
    payload = json.dumps({
        "id": req_id,
        "action": "send",
        "target": target,
        "message": message
    })

    logger.info(f"Dispatching send command: target='{target}', message='{message}' (id={req_id})")
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


async def handle_chats(request):
    """查詢目前可見聊天列表"""
    if not active_ws_clients:
        return web.json_response({
            "success": False,
            "error": "LINE Chrome 擴充功能尚未連線"
        }, status=503)

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
    # 支援 CORS，方便任何後端或跨來源測試
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

    # 路由
    app.router.add_get("/", ws_handler)           # WebSocket 端點 (ws://127.0.0.1:8765)
    app.router.add_get("/api/status", handle_status)
    app.router.add_post("/api/send", handle_send)
    app.router.add_get("/api/chats", handle_chats)

    return app


if __name__ == "__main__":
    PORT = 8989
    logger.info(f"Starting LINE Bridge Server on http://127.0.0.1:{PORT}")
    app = create_app()
    web.run_app(app, host="127.0.0.1", port=PORT)
