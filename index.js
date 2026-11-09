/**
 * 純 Node.js LINE 副機器人發送服務 (精進版)
 * 支援：免 Docker、免 Chromium、發送文字、標記 @All、收回訊息 (Unsend)
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
  status: "idle"
};

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

function saveToken(token) {
  try {
    fs.writeFileSync(TOKEN_FILE, token, "utf-8");
    console.log("[Auth] Token 已保存至 line_token.txt");
  } catch (err) {
    console.error("[Auth] 保存 Token 失敗:", err.message);
  }
}

async function initClient() {
  const token = getSavedToken();
  if (token) {
    console.log("[Auth] 偵測到既有 Token，嘗試直接登入...");
    try {
      client = await loginWithAuthToken(token);
      currentProfile = await client.getMyProfile();
      qrStatus.status = "logged_in";
      console.log(`[Auth] 登入成功！使用者: ${currentProfile.displayName}`);
      return;
    } catch (err) {
      console.warn("[Auth] 既有 Token 已過期:", err.message);
    }
  }

  startQrLogin();
}

async function startQrLogin() {
  qrStatus.status = "waiting_scan";
  console.log("[Auth] 正在請求登入 QR Code...");

  try {
    client = await loginWithQR({
      onReceiveQRUrl: (url) => {
        qrStatus.url = url;
        qrStatus.status = "waiting_scan";
        console.log("\n================ [請手機掃碼登入] ================");
        console.log("登入連結: " + url);
        qrcodeTerminal.generate(url, { small: true });
        console.log("==================================================\n");
      },
      onPincodeRequest: (pin) => {
        qrStatus.pin = pin;
        qrStatus.status = "waiting_pin";
        console.log(`\n>>> 請在手機輸入 PIN 驗證碼: [ ${pin} ] <<<\n`);
      }
    });

    const authToken = client.base.authToken;
    if (authToken) saveToken(authToken);

    currentProfile = await client.getMyProfile();
    qrStatus.status = "logged_in";
    console.log(`[Auth] 掃碼登入成功！使用者: ${currentProfile.displayName}`);
  } catch (err) {
    console.error("[Auth] QR Code 登入錯誤:", err);
    qrStatus.status = "error";
    setTimeout(startQrLogin, 5000);
  }
}

// 發送訊息 (支援 Mention)
async function sendMessageToTarget(targetName, text, options = {}) {
  if (!client || qrStatus.status !== "logged_in") {
    throw new Error("LINE 客戶端尚未登入完成");
  }

  const chats = await client.fetchJoinedChats();
  let targetChat = chats.find(c => (c.name || c.extra?.groupName) === targetName);
  if (!targetChat) {
    targetChat = chats.find(c => ((c.name || c.extra?.groupName) || "").includes(targetName));
  }
  if (!targetChat) {
    targetChat = chats.find(c => c.mid === targetName);
  }

  if (!targetChat) {
    throw new Error(`找不到群組 "${targetName}"`);
  }

  // 標記處理
  let sendText = text;
  if (options.mention === "all" || options.mentionAll) {
    sendText = `@All ${text}`;
  } else if (options.mentionName) {
    sendText = `@${options.mentionName} ${text}`;
  }

  const res = await targetChat.sendMessage(sendText);
  return {
    chatId: targetChat.mid,
    chatName: targetChat.name || targetChat.extra?.groupName,
    messageId: res?.id || null,
    message: sendText
  };
}

// 收回訊息
async function unsendMessage(messageId) {
  if (!client || qrStatus.status !== "logged_in") {
    throw new Error("LINE 客戶端尚未登入");
  }
  if (!messageId) throw new Error("缺少 messageId");

  if (client.base?.talk?.unsendMessage) {
    await client.base.talk.unsendMessage({ reqSeq: 0, messageId: String(messageId) });
  } else {
    throw new Error("底層協定未支援 unsendMessage 函式");
  }
  return { success: true, messageId };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      status: qrStatus.status === "logged_in" ? "online" : "offline",
      connected_clients: qrStatus.status === "logged_in" ? 1 : 0,
      user: currentProfile ? { displayName: currentProfile.displayName, mid: currentProfile.mid } : null
    }));
    return;
  }

  if (url.pathname === "/login" || url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (qrStatus.status === "logged_in") {
      res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
          <h2 style="color:#00B900;">✓ LINE 副機器人已登入</h2>
          <p>帳號：<b>${currentProfile?.displayName || ""}</b></p>
        </div>
      `);
    } else if (qrStatus.url) {
      res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:40px;">
          <h2>LINE 副機器人掃碼登入</h2>
          <p><a href="${qrStatus.url}" target="_blank" style="color:#00B900;">點此開啟登入連結</a></p>
          ${qrStatus.pin ? `<h3>PIN: <span style="font-size:28px;">${qrStatus.pin}</span></h3>` : ""}
          <script>setTimeout(() => location.reload(), 4000);</script>
        </div>
      `);
    } else {
      res.end(`<h3>正在產生 QR Code...</h3><script>setTimeout(() => location.reload(), 2000);</script>`);
    }
    return;
  }

  if (url.pathname === "/api/send" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const { target, message, mention, mentionAll, mentionName } = data;
        if (!target || !message) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "缺少 target 或 message" }));
          return;
        }
        const result = await sendMessageToTarget(target, message, { mention, mentionAll, mentionName });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, detail: result }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: false, error: err.message || String(err) }));
      }
    });
    return;
  }

  if (url.pathname === "/api/unsend" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const { messageId } = data;
        if (!messageId) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: false, error: "缺少 messageId" }));
          return;
        }
        const result = await unsendMessage(messageId);
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
  console.log(`[Server] 純 Node.js LINE 服務運行於 Port: ${PORT}`);
  initClient();
});
