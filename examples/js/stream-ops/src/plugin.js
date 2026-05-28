// stream-ops — exercises read-only broadcast telemetry, the video config
// read/write pair, and the permission split between them.
//
//   !broadcaster   — the inbound encode (resolution + codecs). Read-only
//                    telemetry, there's nothing to write, so it lives under
//                    the plain `server.read` permission.
//   !videoconfig   — the current output config (latency, codec, variant
//                    count). Settable knobs, read under `videoconfig.read`.
//   !latency <n>   — change the output latency level via
//                    owncast.videoConfig.write — a write that needs the
//                    separate, higher-privilege `videoconfig.write`. Partial
//                    update: only latencyLevel is sent, leaving codec/variants
//                    untouched.
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    const body = (msg.body || "").trim();

    if (body === "!broadcaster") {
      const b = owncast.stream.broadcaster();
      owncast.chat.send(`broadcaster: ${b.resolution || "?"} via ${(b.codecs || []).join("/") || "?"}`);
      return;
    }
    if (body === "!videoconfig") {
      const c = owncast.videoConfig.read();
      owncast.chat.send(`latency ${c.latencyLevel}, codec ${c.codec}, ${c.variants.length} variant(s)`);
      return;
    }

    const m = body.match(/^!latency\s+(\d+)$/);
    if (m) {
      const level = parseInt(m[1], 10);
      owncast.videoConfig.write({ latencyLevel: level });
      owncast.chat.send(`latency set to ${level}`);
    }
  }
});
