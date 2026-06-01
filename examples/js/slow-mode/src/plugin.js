const { definePlugin, filter } = require("@owncast/plugin-sdk");

const MIN_INTERVAL_MS = 2000;

// Per-user last-post times held in plugin memory. The map lives for the
// lifetime of the loaded wasm instance; reloading or restarting the
// plugin resets the limiter, which is the right behavior for a soft
// slow-mode (no stale state across restarts).
const lastByUser = new Map();

module.exports = definePlugin({
  filterChatMessage(msg) {
    // Compare against the host's per-message timestamp. (Date.now() works in
    // the sandbox too, but msg.timestamp is deterministic and what tests
    // assert against.) Key the limiter on the stable user id; show the
    // display name in the drop reason.
    const now = new Date(msg.timestamp).getTime();
    const id = msg.user ? msg.user.id : "anon";
    const name = msg.user ? msg.user.displayName : id;
    const last = lastByUser.get(id) || 0;
    if (last > 0 && now - last < MIN_INTERVAL_MS) {
      return filter.drop(
        `slow-mode: ${name} must wait ${MIN_INTERVAL_MS}ms between messages`,
      );
    }
    lastByUser.set(id, now);
    return filter.pass();
  },
});
