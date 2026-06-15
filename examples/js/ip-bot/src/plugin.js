// A single, fixed command — so this example parses msg.body by hand to show
// that's perfectly fine. For multiple commands, aliases, cooldowns, or
// moderator gating, reach for the SDK's defineCommands router instead (see the
// stream-ops / stream-tracker / timer-bot examples).
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
