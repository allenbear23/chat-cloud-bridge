/**
 * LINE Chrome Extension Automation Hook
 * 建立與本機 Bridge Server 的 WebSocket 通訊，自動選取群組並發送訊息
 */
(function () {
  console.log("[LINE Hook] Initializing LINE Automation Hook...");

  const WS_URL = "ws://127.0.0.1:8989";
  let ws = null;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 取得所有可見的聊天室清單項目
  function getChatItems() {
    const items = document.querySelectorAll('[class*="chatlistItem-module__chatlist_item"]');
    const result = [];
    items.forEach(el => {
      const textEl = el.querySelector('[class*="chatlistItem-module__text"]');
      const title = textEl ? textEl.innerText.trim() : el.innerText.trim();
      result.push({ element: el, title: title });
    });
    return result;
  }

  // 搜尋群組並點選
  async function selectChat(targetName) {
    console.log(`[LINE Hook] Searching for chat: "${targetName}"`);

    // 1. 檢查當前開啟中的聊天室是否已經是目標群組
    const currentHeader = document.querySelector('[class*="chatroomHeader-module__title"]');
    if (currentHeader && currentHeader.innerText.includes(targetName)) {
      console.log(`[LINE Hook] Already in target chat: "${targetName}"`);
      return true;
    }

    // 2. 嘗試在可見列表中直接尋找
    let chats = getChatItems();
    let target = chats.find(c => c.title.includes(targetName));

    // 3. 若找不到，使用搜尋框過濾
    if (!target) {
      const searchInput = document.querySelector('input[class*="searchInput-module__input"], input[type="search"]');
      if (searchInput) {
        searchInput.focus();
        // 模擬輸入搜尋
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeInputSetter.call(searchInput, targetName);
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(500);

        chats = getChatItems();
        target = chats.find(c => c.title.includes(targetName));
      }
    }

    if (!target) {
      throw new Error(`找不到群組或聊天室: "${targetName}"`);
    }

    // 點選聊天室
    target.element.click();
    await sleep(600); // 等待聊天室載入

    // 清理搜尋框狀態
    const resetBtn = document.querySelector('button[class*="searchInput-module__button_reset"]');
    if (resetBtn) {
      resetBtn.click();
    }
    return true;
  }

  // 發送訊息
  async function sendMessage(targetName, messageText) {
    // 1. 選取目標聊天室
    await selectChat(targetName);

    // 2. 尋找輸入框 textarea-ex
    let textareaEx = document.querySelector('textarea-ex');
    for (let i = 0; i < 10 && !textareaEx; i++) {
      await sleep(200);
      textareaEx = document.querySelector('textarea-ex');
    }

    if (!textareaEx) {
      throw new Error("無法定位到訊息輸入框 (textarea-ex)");
    }

    // 3. 聚焦輸入框
    if (textareaEx.focus) {
      textareaEx.focus();
    }

    // 4. 寫入文字
    if (typeof textareaEx.insertValue === 'function') {
      textareaEx.insertValue([messageText]);
    } else if (textareaEx.inputEl) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      nativeSetter.call(textareaEx.inputEl, messageText);
      textareaEx.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const innerTextarea = textareaEx.shadowRoot ? textareaEx.shadowRoot.querySelector('textarea') : textareaEx.querySelector('textarea');
      if (innerTextarea) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeSetter.call(innerTextarea, messageText);
        innerTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        throw new Error("無法寫入輸入框內容");
      }
    }

    await sleep(200);

    // 5. 觸發 Enter 送出
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    textareaEx.dispatchEvent(enterEvent);
    console.log(`[LINE Hook] Message sent to "${targetName}": "${messageText}"`);

    await sleep(300);
    return { success: true, target: targetName, message: messageText };
  }

  // 掛載到 window 供手動測試
  window.__LINE_HOOK__ = {
    sendMessage,
    selectChat,
    getChatItems,
    getStore: () => window.__REDUX_STORE__
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
        console.log("[LINE Hook] Received command:", data);

        if (data.action === "send") {
          try {
            const result = await sendMessage(data.target, data.message);
            ws.send(JSON.stringify({
              id: data.id,
              status: "success",
              result
            }));
          } catch (err) {
            console.error("[LINE Hook] Send failed:", err);
            ws.send(JSON.stringify({
              id: data.id,
              status: "error",
              error: err.message || String(err)
            }));
          }
        } else if (data.action === "list_chats") {
          const chats = getChatItems().map(c => c.title);
          ws.send(JSON.stringify({
            id: data.id,
            status: "success",
            chats
          }));
        }
      } catch (err) {
        console.error("[LINE Hook] Error parsing message:", err);
      }
    };

    ws.onclose = () => {
      console.log("[LINE Hook] Disconnected. Reconnecting in 3s...");
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
      // 靜默關閉，由 onclose 處理重連
      ws.close();
    };
  }

  // 啟動連線
  connectWebSocket();
})();
