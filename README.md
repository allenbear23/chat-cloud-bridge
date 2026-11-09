# LINE 純 Node.js 雲端副機器人發送服務（免 Docker）

本專案採用 `@evex-dev/linejs` 通訊協定函式庫，**完全不需要 Docker、不需要 Chromium 瀏覽器、不需要桌面環境 (Xvfb)**，記憶體消耗僅約 30 MB，可直接於 **Render.com 免費 Node.js 原生環境**運行。

---

## Render 免費部署步驟（純 Node 環境）

### 步驟 1：建立 Web Service
1. 登入 [Render Dashboard](https://dashboard.render.com/)。
2. 點選 **New + -> Web Service**，選擇此 GitHub 專案。
3. 設定參數：
   - **Runtime**: `Node` (不用 Docker)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
4. 點選 **Deploy Web Service**。

---

## 首次掃碼登入（手機即可操作）

服務啟動後，Render 會分配一個公開網址（例如 `https://<你的專案>.onrender.com`）：

1. 使用手機或電腦打開網址：
   ```
   https://<你的專案>.onrender.com/
   ```
2. 網頁會直接顯示登入連結或 QR Code。
3. 手機開啟 LINE 進行掃碼並確認登入（若有 PIN 碼，網頁會同步顯示 4 位數驗證碼）。
4. 登入完成後網頁會顯示「LINE 副機器人已登入完成」。
5. **持久化保存**：日誌中產生的 Token 亦可填入 Render 的環境變數 `LINE_AUTH_TOKEN`，往後重啟自動保持登入。

---

## API 呼叫發送訊息

網站後端直接向該網址發送 POST 請求：

### 發送訊息
- **URL**: `https://<你的專案>.onrender.com/api/send`
- **Method**: `POST`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body**:
  ```json
  {
    "target": "目標群組名稱",
    "message": "這是一則來自雲端網站後端的測試訊息"
  }
  ```

### 檢查狀態
- **URL**: `https://<你的專案>.onrender.com/api/status`
- **Method**: `GET`
- **回應**:
  ```json
  {
    "status": "online",
    "connected_clients": 1,
    "login_status": "logged_in",
    "user": {
      "displayName": "副帳號名稱",
      "mid": "u..."
    }
  }
  ```
