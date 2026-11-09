FROM debian:bullseye-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

# 安裝 Chromium、虛擬桌面、VNC、noVNC、Nginx 與 Python 環境
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    nginx \
    gettext-base \
    python3 \
    python3-pip \
    python3-aiohttp \
    curl \
    ca-certificates \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# 設定 noVNC 路徑別名
RUN ln -s /usr/share/novnc /opt/novnc

WORKDIR /app

# 複製應用程式與設定檔
COPY nginx.conf.template /app/nginx.conf.template
COPY server.py /app/server.py
COPY send_cli.py /app/send_cli.py
COPY entrypoint.sh /app/entrypoint.sh

# 將當前擴充功能代碼放入 /app/extension
COPY . /app/extension/

RUN chmod +x /app/entrypoint.sh /app/server.py /app/send_cli.py

# 預設端口 (Render 執行階段會以 $PORT 覆蓋)
EXPOSE 10000

ENTRYPOINT ["/app/entrypoint.sh"]
