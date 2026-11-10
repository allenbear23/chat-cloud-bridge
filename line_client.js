/**
 * LINE Bridge Client for Node.js (安全監聽與速率版)
 */

class LineBridgeClient {
  constructor(baseUrl = process.env.LINE_BRIDGE_URL || "http://127.0.0.1:8989") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async isOnline() {
    try {
      const res = await fetch(`${this.baseUrl}/api/status`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.status === "online" && (data.connected_clients > 0);
    } catch {
      return false;
    }
  }

  /**
   * 獲取被動接收到的最近訊息 (0 請求率安全讀取)
   * @param {Object} [options]
   * @param {number} [options.limit=20] - 筆數
   * @param {string} [options.chatId] - 指定群組或聊天室 MID
   */
  async getRecentMessages(options = {}) {
    try {
      const params = new URLSearchParams();
      if (options.limit) params.set("limit", options.limit);
      if (options.chatId) params.set("chatId", options.chatId);

      const res = await fetch(`${this.baseUrl}/api/messages?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.messages || [];
    } catch {
      return [];
    }
  }

  /**
   * 發送訊息 (內建速率冷卻保護)
   */
  async sendMessage(target, message, options = {}) {
    try {
      const payload = { target, message, ...options };
      if (options.mentionAll) payload.mention = "all";

      const res = await fetch(`${this.baseUrl}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || `HTTP ${res.status}` };
      }
      return { success: true, detail: data.detail };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }

  /**
   * 收回訊息
   */
  async unsendMessage(target, messageId) {
    try {
      const res = await fetch(`${this.baseUrl}/api/unsend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, messageId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || `HTTP ${res.status}` };
      }
      return { success: true, detail: data.detail };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }
}

module.exports = LineBridgeClient;
