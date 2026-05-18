const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    if (msg.body.trim() !== "!ip") return;
    const res = owncast.http.fetch("https://api.ipify.org?format=json");
    if (res.status !== 200) {
      owncast.chat.send(`couldn't fetch IP (status ${res.status})`);
      return;
    }
    const { ip } = JSON.parse(res.body);
    owncast.chat.send(`server IP: ${ip}`);
  }
});
