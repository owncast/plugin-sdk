const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  on: {
    "relay.announcement.broadcast"(payload) {
      owncast.log.info(`Announcement from ${payload.by}: ${payload.text}`);
    }
  }
});
