#!/bin/bash
set -e

# Render 預設注入 PORT 環境變數，若無則預設為 10000
export PORT="${PORT:-10000}"
echo "[Render Runner] Binding to PORT: ${PORT}"

# 1. 產生 Nginx 設定並啟動
envsubst '${PORT}' < /app/nginx.conf.template > /etc/nginx/conf.d/default.conf
nginx
echo "[Render Runner] Nginx started on port ${PORT}"

# 2. 啟動 Xvfb 虛擬顯示器
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 -ac &
sleep 2

# 3. 啟動輕量視窗管理器
fluxbox &
sleep 1

# 4. 啟動 x11vnc 與 noVNC（供網頁瀏覽器打開進行掃碼登入）
x11vnc -display :99 -forever -nopw -shared -rfbport 5900 &
/opt/novnc/utils/novnc_proxy --vnc localhost:5900 --listen 6080 &
sleep 1

# 5. 啟動 LINE Bridge HTTP/WS 伺服器
python3 /app/server.py &
sleep 2

# 6. 啟動 Chromium 載入擴充功能
EXT_DIR="/app/extension"
PROFILE_DIR="${CHROME_DATA_DIR:-/data/chrome-profile}"
mkdir -p "${PROFILE_DIR}"

echo "[Render Runner] Launching Chromium with LINE Extension..."
exec chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --load-extension="${EXT_DIR}" \
  --user-data-dir="${PROFILE_DIR}" \
  --window-size=1024,768 \
  --window-position=0,0 \
  --no-first-run \
  --no-default-browser-check \
  "chrome-extension://dummy-trigger"
