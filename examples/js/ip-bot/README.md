# ip-bot

When someone types `!ip` in chat, fetches the server's public IP from `api.ipify.org` and posts the result back to chat.

**Demonstrates:** outbound HTTP via `owncast.http.fetch(url)`, the `network.fetch` permission paired with an explicit `network.allowedHosts: ["api.ipify.org"]` in the manifest (the host rejects loads that grant `network.fetch` without an allowlist), and mocking outbound HTTP in scenario tests via `given.httpResponses` so `npm test` doesn't need real network access.
