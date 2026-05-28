const { definePlugin, filter } = require("@owncast/plugin-sdk");

const MIN_INTERVAL_MS = 2000;

// Per-user last-post times held in plugin memory. The map lives for the
// lifetime of the loaded wasm instance; reloading or restarting the
// plugin resets the limiter, which is the right behavior for a soft
// slow-mode (no stale state across restarts).
const lastByUser = new Map();

module.exports = definePlugin({
  filterChatMessage(msg) {
    // The host hands us an RFC3339Nano timestamp on each message: the
    // plugin's only source of real wall-clock time, since extism-js's
    // built-in Date.now() returns a frozen WASI-default value.
    const now = new Date(msg.timestamp).getTime();
    const user = msg.user || "anon";
    const last = lastByUser.get(user) || 0;
    if (last > 0 && now - last < MIN_INTERVAL_MS) {
      return filter.drop(
        `slow-mode: ${user} must wait ${MIN_INTERVAL_MS}ms between messages`,
      );
    }
    lastByUser.set(user, now);
    return filter.pass();
  },
});
