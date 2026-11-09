/**
 * LINE Bridge Client for Node.js (精進版)
 * 支援：普通發送、@All 全體標記、@指定成員標記、收回訊息 (Unsend)
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
   * 發送訊息 (支援 Mention)
   * @param {string} target - 目標群組名稱或 MID
   * @param {string} message - 訊息文字
   * @param {Object} [options]
   * @param {boolean} [options.mentionAll] - 是否標記 @All
   * @param {string} [options.mentionMid] - 欲標記的使用者 MID
   * @param {string} [options.mentionName] - 欲標記的使用者名稱
   */
  async sendMessage(target, message, options = {}) {
    try {
      const payload = {
        target,
        message,
        ...options
      };
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
   * 收回已發送的訊息
   * @param {string} target - 目標群組名稱或 MID
   * @param {string} messageId - 欲收回的訊息序號 ID
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
