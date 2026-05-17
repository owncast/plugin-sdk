const { definePlugin } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  on: {
    "announcement.broadcast"(payload) {
      console.log(`ANNOUNCEMENT from ${payload.by}: ${payload.text}`);
    }
  }
});
