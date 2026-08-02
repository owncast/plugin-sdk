const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    const line = `${msg.user ? msg.user.displayName : "?"}: ${msg.body}`;
    if (msg.body.startsWith("error:")) {
      owncast.log.error(line);
    } else if (msg.body.startsWith("warning:")) {
      owncast.log.warning(line);
    } else {
      owncast.log.info(line);
    }
  }
});
