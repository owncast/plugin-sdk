// overlay plugin: ships a static HTML overlay (assets/index.html) and a
// dynamic JSON API at /api/messages that reads recent chat history from
// Owncast. The page polls the API to render messages live.
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onHttpRequest(req) {
    if (req.method === "GET" && req.path === "/api/messages") {
      const messages = owncast.chat.history(20);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages })
      };
    }
    return { status: 404, body: "not found" };
  }
});
