// overlay plugin: serves recent chat history and streams the complete
// viewer-visible chat, including bot/system/action messages, to its static
// HTML overlay through the host-owned Server-Sent Events endpoint.
const { definePlugin, owncast } = require("@owncast/plugin-sdk");
module.exports = definePlugin({
  onChatMessageBroadcast(message) {
    owncast.sse.send("overlay", "chat", message);
  },

  onHttpRequest(req) {
    if (req.method === "GET" && req.path === "/api/messages") {
      const messages = owncast.chat.history(20);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages }),
      };
    }
    return { status: 404, body: "not found" };
  },
});
