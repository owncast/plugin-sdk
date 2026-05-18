const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    owncast.chat.send(`${msg.user} said: ${msg.body}`);
  }
});
