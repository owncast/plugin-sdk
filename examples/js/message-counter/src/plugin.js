const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    const key = `count:${msg.user}`;
    const next = parseInt(owncast.kv.get(key) || "0", 10) + 1;
    owncast.kv.set(key, String(next));
    owncast.chat.send(`${msg.user} has sent ${next} message(s) total`);
  }
});
