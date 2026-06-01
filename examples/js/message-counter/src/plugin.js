const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    // Key per-user state on the stable user id, not the display name (which
    // can change); show the display name in the message.
    const id = msg.user ? msg.user.id : "anon";
    const name = msg.user ? msg.user.displayName : "someone";
    const key = `count:${id}`;
    const next = parseInt(owncast.kv.get(key) || "0", 10) + 1;
    owncast.kv.set(key, String(next));
    owncast.chat.send(`${name} has sent ${next} message(s) total`);
  }
});
