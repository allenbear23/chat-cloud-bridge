"""
LINE Bridge Client for Python
用於 Python 網站後端 (FastAPI, Flask, Django 等) 直接呼叫 LINE 訊息發送服務
"""

import os
import json
import urllib.request
import urllib.error

class LineBridgeClient:
    def __init__(self, base_url: str = None):
        """
        :param base_url: 服務位址，例如:
            - 本機測試: 'http://127.0.0.1:8989'
            - Render 私有網路: 'http://line-bridge:8989'
            - Render 公開網址: 'https://your-service.onrender.com'
        """
        self.base_url = (base_url or os.environ.get("LINE_BRIDGE_URL", "http://127.0.0.1:8989")).rstrip("/")

    def is_online(self) -> bool:
        """檢查 LINE 擴充功能是否在線"""
        try:
            req = urllib.request.Request(f"{self.base_url}/api/status")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("status") == "online" and data.get("connected_clients", 0) > 0
        except Exception:
            return False

    def send_message(self, target: str, message: str, timeout_sec: float = 15.0) -> dict:
        """
        發送文字訊息至指定群組或好友
        :param target: 目標群組名稱
        :param message: 訊息內容
        :param timeout_sec: 逾時秒數
        :return: {"success": True/False, "error": ...}
        """
        payload = json.dumps({
            "target": target,
            "message": message,
            "timeout": timeout_sec
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self.base_url}/api/send",
            data=payload,
            headers={"Content-Type": "application/json"}
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout_sec + 5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data
        except urllib.error.HTTPError as e:
            try:
                err_data = json.loads(e.read().decode("utf-8"))
                return {"success": False, "error": err_data.get("error", str(e))}
            except Exception:
                return {"success": False, "error": f"HTTP {e.code}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

