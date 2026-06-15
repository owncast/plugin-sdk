// stream-ops, exercises read-only broadcast telemetry, the video config
// read/write pair, and the permission split between them. Commands are declared
// with definePlugin's `commands` table — the SDK wires the chat subscription
// and prefix parsing, so there's no onChatMessage to write.
//
//   !broadcaster  , the inbound encode (resolution + codecs). Read-only
//                    telemetry under the plain `server.read` permission.
//   !videoconfig  , the current output config (latency, codec, variant
//                    count), read under `videoconfig.read`.
//   !latency <n>  , change the output latency level via
//                    owncast.videoConfig.write, a write that needs the
//                    separate, higher-privilege `videoconfig.write`. Partial
//                    update: only latencyLevel is sent, leaving codec/variants
//                    untouched.
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  commands: {
    broadcaster: {
      description: "Report the inbound encode (resolution + codecs)",
      run: () => {
        const b = owncast.stream.broadcaster();
        owncast.chat.send(
          `broadcaster: ${b.resolution || "?"} via ${(b.codecs || []).join("/") || "?"}`,
        );
      },
    },
    videoconfig: {
      description: "Report the current output video config (latency, codec, variants)",
      run: () => {
        const c = owncast.videoConfig.read();
        owncast.chat.send(
          `latency ${c.latencyLevel}, codec ${c.codec}, ${c.variants.length} variant(s)`,
        );
      },
    },
    latency: {
      description: "Set the output latency level",
      usage: "!latency <n>",
      run: (ctx) => {
        const level = parseInt(ctx.args[0], 10);
        if (Number.isNaN(level)) return;
        owncast.videoConfig.write({ latencyLevel: level });
        owncast.chat.send(`latency set to ${level}`);
      },
    },
  },
});
