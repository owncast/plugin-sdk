const { definePlugin, filter, owncast } = require("@owncast/plugin-sdk");

const MIN_INTERVAL_MS = 2000;

module.exports = definePlugin({
  filterChatMessage(msg) {
    const now = new Date(msg.timestamp).getTime();
    const key = `last:${msg.user}`;
    const last = parseInt(owncast.kv.get(key) || "0", 10);
    if (last && (now - last) < MIN_INTERVAL_MS) {
      return filter.drop(`slow-mode: ${msg.user} must wait ${MIN_INTERVAL_MS}ms between messages`);
    }
    owncast.kv.set(key, String(now));
    return filter.pass();
  }
});
