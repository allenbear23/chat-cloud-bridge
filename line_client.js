/**
 * LINE Bridge Client for Node.js
 * 用於網站後端直接呼叫 LINE 訊息發送服務
 */

class LineBridgeClient {
  /**
   * @param {string} baseUrl - 服務位址，例如:
   *   - 本機測試: 'http://127.0.0.1:8989'
   *   - Render 內部私有網路: 'http://line-bridge:8989'
   *   - Render 公開網址: 'https://your-service.onrender.com'
   */
  constructor(baseUrl = process.env.LINE_BRIDGE_URL || "http://127.0.0.1:8989") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * 檢查 LINE 擴充功能是否在線
   * @returns {Promise<boolean>}
   */
  async isOnline() {
    try {
      const res = await fetch(`${this.baseUrl}/api/status`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === "online" && data.connected_clients > 0;
    } catch {
      return false;
    }
  }

  /**
   * 發送文字訊息至指定群組或好友
   * @param {string} target - 目標群組或好友名稱
   * @param {string} message - 欲發送的文字訊息內容
   * @param {number} [timeoutSec=15] - 等待發送完成的超時秒數
   * @returns {Promise<{success: boolean, error?: string, detail?: any}>}
   */
  async sendMessage(target, message, timeoutSec = 15) {
    try {
      const res = await fetch(`${this.baseUrl}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          message,
          timeout: timeoutSec
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return {
          success: false,
          error: data.error || `HTTP ${res.status}: 發送失敗`
        };
      }

      return { success: true, detail: data.detail };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }
}

module.exports = LineBridgeClient;

