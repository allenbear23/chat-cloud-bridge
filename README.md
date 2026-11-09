# LINE Chrome 擴充功能雲端自動發送服務 (支援 Render.com)

本專案將修改後的 LINE Chrome 擴充功能、Chromium 瀏覽器環境、noVNC 遠端登入介面與 HTTP Bridge Server 整合為 Docker 容器，可直接部署在 **Render.com** 等雲端平台。

---

## Render.com 部署步驟

### 步驟 1：推送到 GitHub
將本資料夾建立為 Git 儲存庫並推送到您的 GitHub：
```bash
git init
git add .
git commit -m "feat: LINE Cloud Bridge for Render"
# 推送至您的 GitHub Repo
```

### 步驟 2：在 Render 建立 Web Service
1. 登入 [Render Dashboard](https://dashboard.render.com/)。
2. 點擊 **New +** -> **Web Service**（或 **Blueprints** 直接讀取 `render.yaml`）。
3. 連結剛建立的 GitHub 專案。
4. 設定參數：
   - **Environment**: `Docker`
   - **Instance Type**: 建議選擇 **Starter**（每月約 $7，支援掛載 **Persistent Disk** 保存登入態；若用 Free 方案，伺服器重啟時需重新掃碼）。
5. 若為手動設定（非 Blueprint），於 **Disks** 區塊新增：
   - **Name**: `chrome-profile-data`
   - **Mount Path**: `/data/chrome-profile`
   - **Size**: `1 GB`
6. 點擊 **Deploy Web Service** 進行建置。

---

## 首次掃碼登入

部署完成後，Render 會提供一組專屬網址（例如 `https://line-cloud-bridge.onrender.com`）：

1. 打開瀏覽器訪問該網址：`https://<你的Render網址>/`
2. 畫面會直接顯示雲端伺服器中的桌面與 LINE 視窗。
3. 使用手機 LINE App 掃描畫面中的 QR Code 完成登入。
4. 登入態將自動永久保存在 Render 的掛載硬碟中。

---

## 網站後端呼叫發送訊息

網站後端只需發送標準 HTTP POST 請求至 Render 網址：

### API Endpoint
- **URL**: `https://<你的Render網址>/api/send`
- **Method**: `POST`
- **Headers**:
  ```http
  Content-Type: application/json
  ```
- **Body**:
  ```json
  {
    "target": "目標群組名稱",
    "message": "這是一則來自雲端網站後端的訊息"
  }
  ```

### 檢查在線狀態
- **URL**: `https://<你的Render網址>/api/status`
- **Method**: `GET`
- **回應**:
  ```json
  {
    "status": "online",
    "connected_clients": 1
  }
  ```
