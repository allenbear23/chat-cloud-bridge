/**
 * LINE Chrome Extension Automation Hook (精進版)
 * 結合官方內部 Redux Action 與 DOM 自動化
 * 支援：免切換背景發送、@指定人標記、@All 全體標記、訊息收回 (Unsend)
 */
(function () {
  console.log("[LINE Hook] Initializing High-Performance LINE Automation Hook...");

  const WS_URL = "ws://127.0.0.1:8989";
  let ws = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 取得全域 Store 與 Actions
  function getStore() {
    return window.__REDUX_STORE__ || null;
  }
  function getActions() {
    return window.__LINE_MESSAGE_ACTIONS__ || null;
  }

  // 透過 Redux State 取得群組或聊天室 MID
  function findChatMidByName(targetName) {
    const store = getStore();
    if (!store) return null;
    const state = store.getState();

    // 1. 搜尋 messageBoxes
    const boxes = state?.messageBox?.entities?.messageBoxes || {};
    for (const [id, box] of Object.entries(boxes)) {
      const name = box.title || box.name || box.extra?.groupName || "";
      if (name === targetName || name.includes(targetName) || id === targetName) {
        return id;
      }
    }

    // 2. 搜尋 contacts
    const contacts = state?.contact?.entities?.contacts || {};
    for (const [id, contact] of Object.entries(contacts)) {
      const name = contact.displayNameOverridden || contact.displayName || "";
      if (name === targetName || name.includes(targetName) || id === targetName) {
        return id;
      }
    }

    return null;
  }

  // 透過 DOM 取得清單
  function getChatItems() {
    const items = document.querySelectorAll('[class*="chatlistItem-module__chatlist_item"]');
    const result = [];
    items.forEach((el) => {
      const textEl = el.querySelector('[class*="chatlistItem-module__text"]');
      const title = textEl ? textEl.innerText.trim() : el.innerText.trim();
      result.push({ element: el, title: title });
    });
    return result;
  }

  // DOM 方式選取聊天室 (Fallback)
  async function selectChatDOM(targetName) {
    let chats = getChatItems();
    let target = chats.find((c) => c.title.includes(targetName));

    if (!target) {
      const searchInput = document.querySelector('input[class*="searchInput-module__input"], input[type="search"]');
      if (searchInput) {
        searchInput.focus();
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeInputSetter.call(searchInput, targetName);
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(500);

        chats = getChatItems();
        target = chats.find((c) => c.title.includes(targetName));
      }
    }

    if (!target) throw new Error(`找不到群組: "${targetName}"`);
    target.element.click();
    await sleep(500);

    const resetBtn = document.querySelector('button[class*="searchInput-module__button_reset"]');
    if (resetBtn) resetBtn.click();
    return true;
  }

  // 核心發送：優先走內部 Action，毫秒級背景發送且支援 Mention
  async function sendMessage(targetName, messageText, options = {}) {
    const store = getStore();
    const actions = getActions();
    const targetMid = findChatMidByName(targetName);

    // 組織文字與 Mention 區塊
    let valuePayload = [];
    if (options.mentionAll || options.mention === "all") {
      // 標記全體 @All
      valuePayload.push({
        type: 2, // MENTION
        altText: "@All",
        extra: { data: { A: "1" } }
      });
      valuePayload.push(" " + messageText);
    } else if (options.mentionMid) {
      // 標記特定成員
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

    // 途徑 1：直接透過官方內部 Redux Thunk 發送（免切換視窗、零延遲、E2EE 完全自動）
    if (store && actions && actions.enqueueTextMessage && targetMid) {
      console.log(`[LINE Hook] Using direct Action dispatch for "${targetName}" (${targetMid})`);
      store.dispatch(
        actions.enqueueTextMessage({
          messageBoxId: targetMid,
          value: valuePayload
        })
      );
      return { success: true, method: "redux_action", target: targetName, mid: targetMid, message: messageText };
    }

    // 途徑 2：回退至 DOM 模擬發送
    console.warn(`[LINE Hook] Falling back to DOM simulated sending for "${targetName}"`);
    await selectChatDOM(targetName);

    let textareaEx = document.querySelector("textarea-ex");
    for (let i = 0; i < 10 && !textareaEx; i++) {
      await sleep(200);
      textareaEx = document.querySelector("textarea-ex");
    }
    if (!textareaEx) throw new Error("無法定位到輸入框 (textarea-ex)");

    if (textareaEx.focus) textareaEx.focus();
    if (typeof textareaEx.insertValue === "function") {
      textareaEx.insertValue(valuePayload);
    } else {
      const innerTextarea = textareaEx.shadowRoot ? textareaEx.shadowRoot.querySelector("textarea") : textareaEx.querySelector("textarea");
      if (innerTextarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeSetter.call(innerTextarea, messageText);
        innerTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    await sleep(200);
    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    textareaEx.dispatchEvent(enterEvent);

    return { success: true, method: "dom_simulate", target: targetName, message: messageText };
  }

  // 核心功能：收回訊息 (Unsend Message)
  async function unsendMessage(targetName, messageId) {
    const store = getStore();
    const actions = getActions();
    const targetMid = findChatMidByName(targetName) || targetName;

    if (!store || !actions || !actions.unsendMessage) {
      throw new Error("內部 unsendMessage Action 尚未就緒");
    }
    if (!messageId) {
      throw new Error("收回訊息必須提供 messageId");
    }

    console.log(`[LINE Hook] Unsending message "${messageId}" in "${targetName}" (${targetMid})...`);
    store.dispatch(
      actions.unsendMessage({
        messageId: String(messageId),
        messageBoxId: targetMid
      })
    );

    return { success: true, target: targetName, messageId: messageId };
  }

  // 掛載到 window 供除錯與手動測試
  window.__LINE_HOOK__ = {
    sendMessage,
    unsendMessage,
    findChatMidByName,
    getStore,
    getActions
  };

  // 連接本地 Bridge Server (WebSocket)
  function connectWebSocket() {
    console.log(`[LINE Hook] Connecting to ${WS_URL}...`);
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[LINE Hook] Connected to Bridge Server!");
      ws.send(JSON.stringify({ type: "ready", client: "line_extension" }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        // 1. 發送訊息
        if (data.action === "send") {
          try {
            const result = await sendMessage(data.target, data.message, data.options || {});
            ws.send(JSON.stringify({ id: data.id, status: "success", result }));
          } catch (err) {
            ws.send(JSON.stringify({ id: data.id, status: "error", error: err.message || String(err) }));
          }
        }
        // 2. 收回訊息
        else if (data.action === "unsend") {
          try {
            const result = await unsendMessage(data.target, data.messageId);
            ws.send(JSON.stringify({ id: data.id, status: "success", result }));
          } catch (err) {
            ws.send(JSON.stringify({ id: data.id, status: "error", error: err.message || String(err) }));
          }
        }
        // 3. 取得所有聊天室列表與 MID
        else if (data.action === "list_chats") {
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
