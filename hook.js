/**
 * LINE Chrome Extension Automation Hook (安全讀取與速率保護版)
 * 核心特性：
 * 1. 被動即時讀取：透過 Redux 狀態監聽被動攔截新進訊息，對 LINE 伺服器 0 額外請求，100% 安全。
 * 2. 嚴格發話速率保護 (Rate Limiter)：強制發話冷卻時間，防止突發連發觸發風控。
 * 3. 隱身模式：不主動發送已讀回條 (Read Receipts)。
 */
(function () {
  console.log("[LINE Hook] Initializing Safe Listener & Controlled Rate Hook...");

  const WS_URL = "ws://127.0.0.1:8989";
  let ws = null;

  // 速率限制變數：上次發話時間戳記
  let lastSendTimestamp = 0;
  const MIN_SEND_INTERVAL_MS = 3000; // 兩次發話之間強制至少間隔 3 秒

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getStore() {
    return window.__REDUX_STORE__ || null;
  }
  function getActions() {
    return window.__LINE_MESSAGE_ACTIONS__ || null;
  }

  // 根據名稱找 MID
  function findChatMidByName(targetName) {
    const store = getStore();
    if (!store) return null;
    const state = store.getState();

    const boxes = state?.messageBox?.entities?.messageBoxes || {};
    for (const [id, box] of Object.entries(boxes)) {
      const name = box.title || box.name || box.extra?.groupName || "";
      if (name === targetName || name.includes(targetName) || id === targetName) {
        return id;
      }
    }

    const contacts = state?.contact?.entities?.contacts || {};
    for (const [id, contact] of Object.entries(contacts)) {
      const name = contact.displayNameOverridden || contact.displayName || "";
      if (name === targetName || name.includes(targetName) || id === targetName) {
        return id;
      }
    }

    return null;
  }

  // ====================== 核心功能 1：被動即時監聽訊息 ======================
  const processedMessageIds = new Set();
  let isListenerAttached = false;

  function attachStoreMessageListener() {
    const store = getStore();
    if (!store || isListenerAttached) return;

    // 先初始化既有的訊息 ID，避免剛啟動時把舊訊息全當作新訊息
    const initialState = store.getState();
    const initialMessages = initialState?.message?.entities?.messages || {};
    for (const id of Object.keys(initialMessages)) {
      processedMessageIds.add(id);
    }
    console.log(`[LINE Hook] Message listener attached. Initialized with ${processedMessageIds.size} existing messages.`);

    // 訂閱 Store 變更 (被動接收，對官方伺服器 0 網路請求)
    store.subscribe(() => {
      try {
        const state = store.getState();
        const messages = state?.message?.entities?.messages || {};
        const messageBoxes = state?.messageBox?.entities?.messageBoxes || {};
        const contacts = state?.contact?.entities?.contacts || {};
        const myMid = state?.auth?.profile?.mid || "";

        for (const [id, msg] of Object.entries(messages)) {
          if (!processedMessageIds.has(id)) {
            processedMessageIds.add(id);

            // 若快取超過 2000 筆，修剪舊資料
            if (processedMessageIds.size > 2000) {
              const firstKey = processedMessageIds.values().next().value;
              processedMessageIds.delete(firstKey);
            }

            // 略過本機剛送出中的本地臨時訊息
            if (String(id).startsWith("local-")) continue;

            const targetMid = msg.to;
            const senderMid = msg.from;
            const isSelf = senderMid === myMid;

            // 取得群組/聊天室名稱
            const box = messageBoxes[targetMid];
            const chatName = box?.title || box?.name || box?.extra?.groupName || targetMid;

            // 取得發送者名稱
            const senderContact = contacts[senderMid];
            const senderName = senderContact?.displayNameOverridden || senderContact?.displayName || (isSelf ? "我" : senderMid);

            const messageData = {
              id: String(id),
              chatId: targetMid,
              chatName: chatName,
              senderId: senderMid,
              senderName: senderName,
              isSelf: isSelf,
              text: msg.text || "",
              contentType: msg.contentType,
              createdTime: msg.createdTime || Date.now()
            };

            console.log(`[LINE Hook] 📩 接收到新訊息 [${chatName}] ${senderName}: ${msg.text}`);

            // 透過 WebSocket 即時轉發給 Bridge Server
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "new_message",
                data: messageData
              }));
            }
          }
        }
      } catch (err) {
        console.error("[LINE Hook] Error in store listener:", err);
      }
    });

    isListenerAttached = true;
  }

  // 檢查並持續等待 Store 就緒後掛載監聽
  function ensureListener() {
    if (!isListenerAttached) {
      if (getStore()) {
        attachStoreMessageListener();
      } else {
        setTimeout(ensureListener, 1000);
      }
    }
  }
  ensureListener();

  // ====================== 核心功能 2：嚴格速率受控發送 ======================
  async function sendMessageControlled(targetName, messageText, options = {}) {
    // 嚴格速率檢查：防止高頻發送
    const now = Date.now();
    const elapsed = now - lastSendTimestamp;
    if (elapsed < MIN_SEND_INTERVAL_MS) {
      const waitTime = MIN_SEND_INTERVAL_MS - elapsed;
      console.warn(`[LINE Hook] 發話速率冷卻中，主動等待 ${waitTime}ms...`);
      await sleep(waitTime);
    }
    lastSendTimestamp = Date.now();

    const store = getStore();
    const actions = getActions();
    const targetMid = findChatMidByName(targetName);

    let valuePayload = [];
    if (options.mentionAll || options.mention === "all") {
      valuePayload.push({
        type: 2,
        altText: "@All",
        extra: { data: { A: "1" } }
      });
      valuePayload.push(" " + messageText);
    } else if (options.mentionMid) {
      const mentionName = options.mentionName || "成員";
      valuePayload.push({
        type: 2,
        altText: `@${mentionName}`,
        extra: { data: { M: options.mentionMid } }
      });
      valuePayload.push(" " + messageText);
    } else {
      valuePayload.push(messageText);
    }

    if (store && actions && actions.enqueueTextMessage && targetMid) {
      console.log(`[LINE Hook] Action dispatch to "${targetName}" (${targetMid})`);
      store.dispatch(
        actions.enqueueTextMessage({
          messageBoxId: targetMid,
          value: valuePayload
        })
      );
      return { success: true, method: "redux_action", target: targetName, mid: targetMid, message: messageText };
    }

    throw new Error("LINE 客戶端內部發送 Action 尚未初始化完成，請確認 LINE 視窗已完全載入。");
  }

  // 收回訊息
  async function unsendMessage(targetName, messageId) {
    const store = getStore();
    const actions = getActions();
    const targetMid = findChatMidByName(targetName) || targetName;

    if (!store || !actions || !actions.unsendMessage) {
      throw new Error("內部 unsendMessage Action 尚未就緒");
    }
    store.dispatch(
      actions.unsendMessage({
        messageId: String(messageId),
        messageBoxId: targetMid
      })
    );
    return { success: true, target: targetName, messageId: messageId };
  }

  // ====================== WebSocket 通訊 ======================
  function connectWebSocket() {
    console.log(`[LINE Hook] Connecting to ${WS_URL}...`);
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[LINE Hook] Connected to Bridge Server!");
      ws.send(JSON.stringify({ type: "ready", client: "line_extension" }));
      ensureListener();
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.action === "send") {
          try {
            const result = await sendMessageControlled(data.target, data.message, data.options || {});
            ws.send(JSON.stringify({ id: data.id, status: "success", result }));
          } catch (err) {
            ws.send(JSON.stringify({ id: data.id, status: "error", error: err.message || String(err) }));
          }
        } else if (data.action === "unsend") {
          try {
            const result = await unsendMessage(data.target, data.messageId);
            ws.send(JSON.stringify({ id: data.id, status: "success", result }));
          } catch (err) {
            ws.send(JSON.stringify({ id: data.id, status: "error", error: err.message || String(err) }));
          }
        } else if (data.action === "list_chats") {
          const store = getStore();
          const boxes = store?.getState()?.messageBox?.entities?.messageBoxes || {};
          const chats = Object.values(boxes).map((b) => ({
            id: b.id,
            name: b.title || b.name || b.extra?.groupName || "未命名"
          }));
          ws.send(JSON.stringify({ id: data.id, status: "success", chats }));
        }
      } catch (err) {
        console.error("[LINE Hook] Error parsing message:", err);
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 3000);
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  connectWebSocket();
})();
