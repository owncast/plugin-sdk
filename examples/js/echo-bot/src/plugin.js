const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    const name = msg.user ? msg.user.displayName : "someone";
    owncast.chat.send(`${name} said: ${msg.body}`);
  }
});
