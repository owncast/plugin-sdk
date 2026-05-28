// safeguard-stress: misbehaves on demand to exercise host sandbox limits.
// Each handler dispatches on the payload `cmd` field. Tests in
// owncast/plugin/manager_safeguards_test.go drive these branches.

const { definePlugin, filter } = require("@owncast/plugin-sdk");

function hugeString(bytes) {
  return "x".repeat(bytes);
}

// Pre-built at module-load so the handlers return them instantly, building
// multi-MB strings inside a 50ms filter call would otherwise hit the per-call
// timeout before we got to test the output-size cap.
// Sized just over each cap so the handler can serialize and return the
// payload within the per-call timeout, the tests want the *size* check to
// fire, not the timeout. (MaxFilterOutputBytes = 1 MiB; we send 1.1 MiB.
// MaxHTTPHandlerOutputBytes = 12 MiB; HTTP test has a 5s call cap so 13 MiB
// is fine there.)
const HUGE_FILTER_BODY = hugeString(1126400); // ~1.075 MiB, > 1 MiB cap
const HUGE_HTTP_BODY = hugeString(13 * 1024 * 1024);

module.exports = definePlugin({
  filterChatMessage(msg) {
    switch (msg && msg.cmd) {
      case "spin":
        // Tight loop, bounded by the host's per-filter timeout.
        while (true) {}
      case "huge-output":
        // Return a payload larger than MaxFilterOutputBytes (1 MiB).
        return filter.modify({ body: HUGE_FILTER_BODY });
      case "alloc":
        // Try to allocate more wasm memory than MaxWasmPages allows.
        // Holding the reference forces actual growth.
        msg._hold = new Uint8Array(80 * 1024 * 1024); // 80 MiB
        return filter.pass();
      default:
        return filter.pass();
    }
  },

  onChatMessage(msg) {
    switch (msg && msg.cmd) {
      case "spin":
        while (true) {}
      default:
        // No-op; existence of the handler is enough to test the timeout
        // wrapping path.
        return;
    }
  },

  onHttpRequest(req) {
    // Path is "/<cmd>". Examples: /spin, /huge.
    const cmd = (req.path || "/").slice(1);
    switch (cmd) {
      case "spin":
        while (true) {}
      case "huge":
        return { status: 200, body: HUGE_HTTP_BODY }; // > MaxHTTPHandlerOutputBytes
      default:
        return { status: 200, body: "ok" };
    }
  },
});
