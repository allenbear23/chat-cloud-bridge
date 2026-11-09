#!/usr/bin/env python3
"""
命令列快速發送工具
用法: python3 send_cli.py <群組名稱> <訊息文字>
"""

import sys
import json
import urllib.request
import urllib.error

API_URL = "http://127.0.0.1:8989/api/send"

def send(target, message):
    payload = json.dumps({"target": target, "message": message}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print("發送結果:", json.dumps(data, ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        print(f"錯誤 (HTTP {e.code}): {err_body}")
    except Exception as e:
        print(f"連線失敗: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("用法: python3 send_cli.py <群組或好友名稱> <訊息內容>")
        sys.exit(1)
    
    send(sys.argv[1], sys.argv[2])
