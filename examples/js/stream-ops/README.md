# stream-ops

Answers chat commands about the stream's video pipeline and lets an operator tune it:
`!broadcaster` reports the inbound encode, `!videoconfig` reports the current output config, and `!latency <n>` changes the output latency level.

**Demonstrates:** the permission split between read-only telemetry and settable config, `owncast.stream.broadcaster()` under `server.read` (there's nothing to write), the `owncast.videoConfig.read()` reader under `videoconfig.read`, and the partial `owncast.videoConfig.write({...})` mutation under the separate, higher-privilege `videoconfig.write`.
