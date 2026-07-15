// all-permissions-test: a build/load canary, not a real plugin. It declares
// every permission the host offers and registers a no-op handler for every
// subscription, so the install-time load check (owncast-plugin-test, which CI
// builds from owncast@develop) fails the moment the host adds, renames, or
// re-gates a permission or subscription.
//
// When the host's permission catalog changes, update this plugin's manifest,
// its Python twin, and the permission table in docs/PLUGIN_AUTHOR_GUIDE.md
// together.
const { definePlugin, filter, authCheck } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  // Declarative command registration (host-matched dispatch).
  commands: {
    noop: {
      description: "Does nothing (canary)",
      run() {},
    },
  },

  onChatMessage() {},
  // Requires chat.filter.
  filterChatMessage: () => filter.pass(),
  onChatUserJoined() {},
  onChatUserParted() {},
  onChatUserRenamed() {},
  onMessageModerated() {},
  onStreamStarted() {},
  onStreamStopped() {},
  onStreamTitleChanged() {},
  // Require http.sse.
  onSseConnect() {},
  onSseDisconnect() {},
  onTick() {},
  // The seven fediverse handlers require fediverse.inbound.
  onFediverse() {},
  onFediverseFollow() {},
  onFediverseLike() {},
  onFediverseRepost() {},
  onFediverseQuote() {},
  onFediverseMention() {},
  onFediverseReply() {},
  // Requires http.serve.
  onHttpRequest: () => ({ status: 204 }),
  // Requires auth.gate.
  onAuthCheck: () => authCheck.ok(),
  // Require ui.modify.
  onPageStyles: () => "",
  onPageScripts: () => "",
  // Custom plugin-to-plugin event subscription.
  on: {
    "all-permissions-test.noop": () => {},
  },
});
