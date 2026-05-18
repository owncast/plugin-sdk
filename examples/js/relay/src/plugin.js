const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const ANNOUNCEMENT_BROADCAST = "announcement.broadcast";

module.exports = definePlugin({
  onChatMessage(msg) {
    const prefix = "/announce ";
    if (!msg.body.startsWith(prefix)) return;
    owncast.events.emit(ANNOUNCEMENT_BROADCAST, {
      text: msg.body.substring(prefix.length),
      by: msg.user,
      at: msg.timestamp
    });
  }
});
