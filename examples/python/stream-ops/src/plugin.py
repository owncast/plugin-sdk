# stream-ops: exercises read-only broadcast telemetry, the video config
# read/write pair, the permission split between them, and declarative commands.
#
#   !broadcaster   - the inbound encode (resolution + codecs). Read-only
#                    telemetry under the plain `server.read` permission.
#   !videoconfig   - the current output config (latency, codec, variant
#                    count), read under `videoconfig.read`.
#   !latency <n>   - change the output latency level via
#                    owncast.video_config.write, a write that needs the
#                    separate, higher-privilege `videoconfig.write`. Partial
#                    update: only latencyLevel is sent, leaving codec/variants
#                    untouched.
from owncast_plugin import plugin, owncast


def _broadcaster(ctx):
    b = owncast.stream.broadcaster()
    codecs = "/".join(b.codecs or []) or "?"
    owncast.chat.send(f"broadcaster: {b.resolution or '?'} via {codecs}")


def _videoconfig(ctx):
    c = owncast.video_config.read()
    owncast.chat.send(
        f"latency {c.latency_level}, codec {c.codec}, {len(c.variants)} variant(s)"
    )


def _latency(ctx):
    if not ctx.args:
        return
    try:
        level = int(ctx.args[0])
    except ValueError:
        return
    owncast.video_config.write({"latencyLevel": level})
    owncast.chat.send(f"latency set to {level}")


plugin.commands({
    "broadcaster": {
        "description": "Report the inbound encode (resolution + codecs)",
        "run": _broadcaster,
    },
    "videoconfig": {
        "description": "Report the current output video config (latency, codec, variants)",
        "run": _videoconfig,
    },
    "latency": {
        "description": "Set the output latency level",
        "usage": "!latency <n>",
        "run": _latency,
    },
})
