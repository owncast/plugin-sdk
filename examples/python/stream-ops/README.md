# stream-ops

Answers chat commands about the stream's video pipeline and lets an operator tune it:
`!broadcaster` reports the inbound encode, `!videoconfig` reports the current output config, and `!latency <n>` changes the output latency level.

**Demonstrates:** the permission split between read-only telemetry and settable config. `owncast.stream.broadcaster()` runs under `server.read` (there's nothing to write), the `owncast.video_config.read()` reader runs under `videoconfig.read`, and the partial `owncast.video_config.write({...})` mutation runs under the separate, higher-privilege `videoconfig.write`.
