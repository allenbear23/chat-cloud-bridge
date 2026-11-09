/**
 * 純 Node.js LINE 副機器人發送服務
 * 完全不需 Docker、不需 Chromium、記憶體佔用小於 50MB
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { loginWithAuthToken, loginWithQR } from "@evex-dev/linejs";
import qrcodeTerminal from "qrcode-terminal";

const PORT = process.env.PORT || 8989;
const TOKEN_FILE = path.join(process.cwd(), "line_token.txt");

let client = null;
let currentProfile = null;
let qrStatus = {
  url: null,
  pin: null,
  status: "idle" // idle | waiting_scan | waiting_pin | logged_in
};

// 讀取既有 Token
function getSavedToken() {
  if (process.env.LINE_AUTH_TOKEN) return process.env.LINE_AUTH_TOKEN.trim();
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      return fs.readFileSync(TOKEN_FILE, "utf-8").trim();
    } catch {
      return null;
    }
  }
  return null;
}

// 儲存 Token
function saveToken(token) {
  try {
    fs.writeFileSync(TOKEN_FILE, token, "utf-8");
    console.log("[Auth] Token 已持久化保存至 line_token.txt");
  } catch (err) {
    console.error("[Auth] 保存 Token 失敗:", err.message);
  }
}

// 初始化 LINE 客戶端
async function initClient() {
  const token = getSavedToken();
  if (token) {
    console.log("[Auth] 偵測到既有 Token，嘗試直接登入...");
    try {
      client = await loginWithAuthToken(token);
      currentProfile = await client.getMyProfile();
      qrStatus.status = "logged_in";
      console.log(`[Auth] 登入成功！使用者: ${currentProfile.displayName} (MID: ${currentProfile.mid})`);
      return;
    } catch (err) {
      console.warn("[Auth] 既有 Token 已失效或過期，請重新掃碼登入:", err.message);
    }
  }

  // 若無 Token 或失效，開始 QR Code 登入流程
  startQrLogin();
}

// 啟動 QR Code 登入
async function startQrLogin() {
  qrStatus.status = "waiting_scan";
  console.log("[Auth] 正在請求 LINE 登入 QR Code...");

  try {
    client = await loginWithQR({
      onReceiveQRUrl: (url) => {
        qrStatus.url = url;
        qrStatus.status = "waiting_scan";
        console.log("\n================ [請使用手機 LINE 掃碼登入] ================");
        console.log("登入連結: " + url);
        qrcodeTerminal.generate(url, { small: true });
        console.log("============================================================\n");
      },
      onPincodeRequest: (pin) => {
        qrStatus.pin = pin;
        qrStatus.status = "waiting_pin";
        console.log("\n>>> 請在手機 LINE 輸入此 PIN 驗證碼: [ " + pin + " ] <<<\n");
      }
    });

    const authToken = client.base.authToken;
    if (authToken) {
      saveToken(authToken);
    }

    currentProfile = await client.getMyProfile();
    qrStatus.status = "logged_in";
    console.log(`[Auth] 掃碼登入成功！登入者: ${currentProfile.displayName}`);
  } catch (err) {
    console.error("[Auth] QR Code 登入流程出錯:", err);
    qrStatus.status = "error";
    // 5 秒後可重試
    setTimeout(startQrLogin, 5000);
  }
}

// 根據群組名稱尋找聊天室並發送訊息
async function sendMessageToTarget(targetName, text) {
  if (!client || qrStatus.status !== "logged_in") {
    throw new Error("LINE 客戶端尚未登入完成，請先開啟登入網址掃碼。");
  }

  console.log(`[Message] 搜尋群組: "${targetName}"...`);
  const chats = await client.fetchJoinedChats();
  
  // 優先精確比對名稱，其次比對包含名稱或 ID
  let targetChat = chats.find(c => (c.name || c.extra?.groupName) === targetName);
  if (!targetChat) {
    targetChat = chats.find(c => ((c.name || c.extra?.groupName) || "").includes(targetName));
  }
  if (!targetChat) {
    targetChat = chats.find(c => c.mid === targetName);
  }

  if (!targetChat) {
    const chatNames = chats.map(c => c.name || c.extra?.groupName).filter(Boolean);
    throw new Error(`找不到名稱為 "${targetName}" 的群組。目前已加入群組有: [${chatNames.join(", ")}]`);
  }

  console.log(`[Message] 找到群組: "${targetChat.name || targetChat.mid}"，正在發送訊息...`);
  await targetChat.sendMessage(text);
  console.log(`[Message] 發送成功: "${text}"`);
  return {
    chatId: targetChat.mid,
    chatName: targetChat.name || targetChat.extra?.groupName,
    message: text
  };
}

// 建立輕量 HTTP 伺服器
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // 1. 狀態檢查 API
  if (url.pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      status: qrStatus.status === "logged_in" ? "online" : "offline",
      connected_clients: qrStatus.status === "logged_in" ? 1 : 0,
      login_status: qrStatus.status,
      user: currentProfile ? { displayName: currentProfile.displayName, mid: currentProfile.mid } : null
    }));
    return;
  }

  // 2. 登入網頁 (瀏覽器打開可直接掃碼)
  if (url.pathname === "/login" || url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (qrStatus.status === "logged_in") {
      res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
          <h2 style="color:#00B900;">✓ LINE 副機器人已登入完成</h2>
          <p>帳號：<b>${currentProfile?.displayName || "已連線"}</b></p>
          <p>服務運作中，可直接由後端呼叫發送 API。</p>
        </div>
      `);
    } else if (qrStatus.url) {
      res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:40px;">
          <h2>LINE 副機器人掃碼登入</h2>
          <p>請使用手機 LINE 掃描下方 QR Code，或點擊連結登入：</p>
          <div style="margin:20px 0;">
            <a href="${qrStatus.url}" target="_blank" style="font-size:16px; color:#00B900; word-break:break-all;">點此開啟登入連結</a>
          </div>
          ${qrStatus.pin ? `<h3 style="color:#e74c3c;">驗證碼 (PIN Code): <span style="font-size:32px; background:#f8f9fa; padding:4px 12px; border:1px solid #ccc; border-radius:4px;">${qrStatus.pin}</span></h3><p>請在手機跳出驗證時輸入上方 4 位數字</p>` : `<p>（若手機提示需要驗證碼，請刷新此頁面查看）</p>`}
          <script>setTimeout(() => location.reload(), 4000);</script>
        </div>
      `);
    } else {
      res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
          <h3>正在產生登入資訊，請稍候...</h3>
          <script>setTimeout(() => location.reload(), 2000);</script>
        </div>
      `);
    }
    return;
  }

  // 3. 發送訊息 API (POST /api/send)
  if (url.pathname === "/api/send" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const { target, message } = data;
        if (!target || !message) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "缺少 target 或 message 參數" }));
          return;
        }

        const result = await sendMessageToTarget(target, message);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, detail: result }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: err.message || String(err) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`[Server] 純 Node.js LINE 橋接伺服器正在運行於 Port: ${PORT}`);
  initClient();
});
