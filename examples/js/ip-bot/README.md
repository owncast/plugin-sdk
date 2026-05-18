# ip-bot

When someone types `!ip` in chat, fetches the server's public IP from `api.ipify.org` and posts the result back to chat.

**Demonstrates:** outbound HTTP via `owncast.http.fetch(url)`, the `network.fetch` permission, mocking outbound HTTP in scenario tests with `given.httpResponses` (no real network call needed for `npm test`).
