# JavaScript plugin examples

One self-contained npm project per directory. Each has its own `README.md` with a longer description; the table below is a quick map of which example covers which SDK feature.

| Plugin | One-line summary |
|---|---|
| [hello-world](./hello-world/) | Minimum viable plugin — proves the load + `register()` path works. |
| [chat-logger](./chat-logger/) | Logs every chat message; the simplest notification handler. |
| [echo-bot](./echo-bot/) | Posts a reply to every chat message via `owncast.chat.send`. |
| [message-counter](./message-counter/) | Per-user message counter persisted in the plugin's namespaced KV. |
| [profanity-filter](./profanity-filter/) | `filter.modify(payload)` — rewrites flagged words to asterisks. |
| [slow-mode](./slow-mode/) | `filter.drop(reason)` — rate-limits per user, with KV-backed state. |
| [buggy-filter](./buggy-filter/) | Always throws — exercises the host's fail-open + strike system. |
| [relay](./relay/) | Emits a custom `announcement.broadcast` event (plugin → plugin). |
| [announcer](./announcer/) | Subscribes to `announcement.broadcast` via the `on: { ... }` map. |
| [ip-bot](./ip-bot/) | Outbound HTTP via `owncast.http.fetch`; mocked in tests. |
| [overlay](./overlay/) | `http.serve` — static `assets/` + dynamic JSON endpoint. |
| [stream-tracker](./stream-tracker/) | Every typed lifecycle / chat-user handler + read APIs. |
| [stream-ops](./stream-ops/) | Broadcast telemetry (`server.read`) + video config read/write (`videoconfig.read`/`videoconfig.write`). |
| [mod-bot](./mod-bot/) | Chat moderation, Discord/browser-push notifications, fediverse post. |
| [admin-demo](./admin-demo/) | `manifest.admin.pages` — host-gated admin routes. |
| [fediverse-chat-bridge](./fediverse-chat-bridge/) | Inbound fediverse mentions → HTML chat system messages with avatars. |
| [safeguard-stress](./safeguard-stress/) | Test fixture — misbehaves on demand to verify host sandbox caps. |

## Building and testing

Each project has the same scripts:

```sh
cd examples/js/<name>
npm install                      # one-time, fetches @owncast/plugin-sdk + extism-js
npm run build                    # produces <name>.wasm
npm test                         # runs scenarios in __tests__/
```

Build them all at once from the repo root:

```sh
for ex in examples/js/*/; do tools/build-plugin.sh "$ex"; done
```
