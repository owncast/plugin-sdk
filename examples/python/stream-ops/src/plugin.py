# stream-ops: exercises read-only broadcast telemetry, the video config
# read/write pair, and the permission split between them.
#
#   !broadcaster   - the inbound encode (resolution + codecs). Read-only
#                    telemetry; there's nothing to write, so it lives under
#                    the plain `server.read` permission.
#   !videoconfig   - the current output config (latency, codec, variant
#                    count). Settable knobs, read under `videoconfig.read`.
#   !latency <n>   - change the output latency level via
#                    owncast.video_config.write, a write that needs the
#                    separate, higher-privilege `videoconfig.write`. Partial
#                    update: only latencyLevel is sent, leaving codec/variants
#                    untouched.
import re

from owncast_plugin import plugin, owncast


@plugin.on_chat_message
def stream_ops(msg):
    body = (msg.body or "").strip()

    if body == "!broadcaster":
        b = owncast.stream.broadcaster()
        codecs = "/".join(b.codecs or []) or "?"
        owncast.chat.send(f"broadcaster: {b.resolution or '?'} via {codecs}")
        return

    if body == "!videoconfig":
        c = owncast.video_config.read()
        owncast.chat.send(
            f"latency {c.latency_level}, codec {c.codec}, {len(c.variants)} variant(s)"
        )
        return

    m = re.match(r"^!latency\s+(\d+)$", body)
    if m:
        level = int(m.group(1))
        owncast.video_config.write({"latencyLevel": level})
        owncast.chat.send(f"latency set to {level}")
