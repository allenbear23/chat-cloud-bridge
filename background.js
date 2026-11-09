import "./cache.js";

const mainWindowId = {
  get: async () => (await chrome.storage.local.get("mainWindow"))?.mainWindow ?? null,
  set: async (e) => await chrome.storage.local.set({ mainWindow: e }),
  remove: async () => await chrome.storage.local.remove("mainWindow")
};

const checkAndDeleteLegacyData = async () => {
  if (!(await chrome.storage.local.get("isOpenedBefore"))?.isOpenedBefore) {
    await chrome.storage.local.clear();
    const e = await indexedDB.databases();
    for (const o of e) await removeDatabase(o);
    await chrome.storage.local.set({ isOpenedBefore: true });
  }
};

const removeDatabase = (e) =>
  new Promise((o, a) => {
    const n = indexedDB.deleteDatabase(e.name);
    n.onsuccess = () => o();
    n.onerror = (e) => a(e);
    n.onblocked = () => a(new Error("deleteDatabase blocked"));
  });

// 開啟 LINE 主視窗
const openLineWindow = async () => {
  try {
    const e = await mainWindowId.get();
    if (e) {
      const exists = await new Promise((o) => {
        chrome.windows.update(e, { focused: true }, (res) => {
          res ? o(true) : (mainWindowId.remove(), o(false));
        });
      });
      if (exists) return;
    }

    await checkAndDeleteLegacyData().catch((err) => {
      console.warn("Failed to delete legacy data", err);
    });

    const o = await chrome.system.display.getInfo();
    const a = (o && o[0] && o[0].bounds) ? o[0].bounds : { left: 0, top: 0, width: 1024, height: 768 };
    const n = { left: a.left + a.width / 2 - 400, top: a.top + a.height / 2 - 290 };

    const t = await chrome.windows.create({
      url: chrome.runtime.getURL("index.html"),
      focused: true,
      left: Math.max(0, Math.floor(n.left)),
      top: Math.max(0, Math.floor(n.top)),
      width: 800,
      height: 580,
      type: "panel"
    });

    await mainWindowId.set(t.id);
    chrome.action.setIcon({
      path: {
        32: "../../line_logo_32x32_on.png",
        48: "../../line_logo_48x48_on.png",
        64: "../../line_logo_64x64_on.png",
        96: "../../line_logo_96x96_on.png",
        128: "../../line_logo_128x128_on.png"
      }
    });
    chrome.action.setBadgeBackgroundColor({ color: "#df4d0f" });
  } catch (err) {
    console.error("[LINE Background] Failed to open main window:", err);
  }
};

// 點擊圖示時開啟
chrome.action.onClicked.addListener(openLineWindow);

// 瀏覽器啟動或擴充功能載入時自動開啟
chrome.runtime.onStartup.addListener(openLineWindow);
chrome.runtime.onInstalled.addListener(openLineWindow);

// 延遲自動開啟 (用於 Headless / 容器自動化啟動)
setTimeout(openLineWindow, 1500);

chrome.windows.onRemoved.addListener(async (e) => {
  if ((await mainWindowId.get()) === e) {
    chrome.action.setIcon({
      path: {
        32: "../../line_logo_32x32_off.png",
        48: "../../line_logo_48x48_off.png",
        64: "../../line_logo_64x64_off.png",
        96: "../../line_logo_96x96_off.png",
        128: "../../line_logo_128x128_off.png"
      }
    });
    chrome.action.setBadgeText({ text: "" });
    await mainWindowId.remove();
  }
});
