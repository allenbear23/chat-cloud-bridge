"""
LINE Bridge Client for Python (安全監聽與速率版)
"""

import os
import json
import urllib.request
import urllib.error

class LineBridgeClient:
    def __init__(self, base_url: str = None):
        self.base_url = (base_url or os.environ.get("LINE_BRIDGE_URL", "http://127.0.0.1:8989")).rstrip("/")

    def is_online(self) -> bool:
        try:
            req = urllib.request.Request(f"{self.base_url}/api/status")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("status") == "online" and data.get("connected_clients", 0) > 0
        except Exception:
            return False

    def get_recent_messages(self, limit: int = 50, chat_id: str = "") -> list:
        """獲取被動接收到的最近訊息 (安全讀取)"""
        try:
            url = f"{self.base_url}/api/messages?limit={limit}"
            if chat_id:
                url += f"&chatId={urllib.parse.quote(chat_id)}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("messages", [])
        except Exception:
            return []

    def send_message(self, target: str, message: str, mention_all: bool = False, mention_mid: str = None, mention_name: str = None, timeout_sec: float = 15.0) -> dict:
        payload = {
            "target": target,
            "message": message,
            "timeout": timeout_sec
        }
        if mention_all:
            payload["mention"] = "all"
        elif mention_mid:
            payload["mentionMid"] = mention_mid
            payload["mentionName"] = mention_name or "成員"

        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(f"{self.base_url}/api/send", data=data_bytes, headers={"Content-Type": "application/json"})

        try:
            with urllib.request.urlopen(req, timeout=timeout_sec + 5) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                err_data = json.loads(e.read().decode("utf-8"))
                return {"success": False, "error": err_data.get("error", str(e))}
            except Exception:
                return {"success": False, "error": f"HTTP {e.code}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def unsend_message(self, target: str, message_id: str, timeout_sec: float = 10.0) -> dict:
        payload = json.dumps({"target": target, "messageId": str(message_id), "timeout": timeout_sec}).encode("utf-8")
        req = urllib.request.Request(f"{self.base_url}/api/unsend", data=payload, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout_sec + 5) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"success": False, "error": str(e)}
