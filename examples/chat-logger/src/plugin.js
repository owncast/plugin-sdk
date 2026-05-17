const { definePlugin } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    console.log(`${msg.user}: ${msg.body}`);
  }
});
