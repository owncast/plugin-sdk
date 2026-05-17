const { definePlugin } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    console.log(`${msg.user} said: ${msg.body}`);
  }

  // Other handlers you can define:
  //   filterChatMessage(msg) { return filter.pass() | filter.modify(...) | filter.drop(reason); }
  //   on: { "your.custom.event"(payload) { ... } }
  //
  // Subscriptions are derived automatically from which handlers you define.
  // Permissions still need to be declared in plugin.manifest.json.
});
