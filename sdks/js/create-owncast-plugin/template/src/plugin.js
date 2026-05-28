const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  // Greet anyone whose message starts with "hi". This handler is also
  // the one __tests__/plugin.test.json asserts on, so you have a
  // working end-to-end example to extend from.
  onChatMessage(msg) {
    if (/^hi\b/i.test(msg.body)) {
      owncast.chat.send(`hello, ${msg.user}!`);
    }
  }

  // Other handlers you can define (subscriptions are derived automatically
  // from which handlers you define; permissions still go in the manifest):
  //   filterChatMessage(msg) { return filter.pass() | filter.modify(...) | filter.drop(reason); }
  //   onChatUserJoined(user) { ... }
  //   onStreamStarted(info) { ... }
  //   on: { "your.custom.event"(payload) { ... } }
  //   onHttpRequest(req) { return { status: 200, body: "..." }; }
});
