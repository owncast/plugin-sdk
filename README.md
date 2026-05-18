# owncast-plugin-sdk (PoC)

Standalone proof-of-concept exploring an in-process plugin system for [Owncast](https://owncast.online): JavaScript plugins compiled to WebAssembly, executed inside a Go host via [Extism](https://extism.org) (which uses [Wazero](https://wazero.io) — pure Go, no CGo).

This isn't part of Owncast yet. It's a sandbox to validate the architecture.

## Documentation

- **[Plugin Author Guide](./docs/PLUGIN_AUTHOR_GUIDE.md)** — start-to-finish guide for writing, testing, and shipping a plugin
- **[Wire Protocol](./docs/WIRE_PROTOCOL.md)** — the contract between the Owncast host and any language SDK; future SDKs and the eventual server-side host runtime both implement this
- **[Host API Roadmap](./docs/HOST_API_ROADMAP.md)** — catalog of Owncast capabilities to expose to plugins (what's shipped, planned, deferred)
- **[TODO / Open Ideas](./docs/TODO.md)** — design ideas and concrete work items still on the punch list

## What's here

Layout mirrors the planned future repo split: `sdks/<lang>/` for author-facing SDKs that ship to package managers, `tools/` for binaries shipped via GitHub releases, `host-runtime-poc/` for the host code that will eventually move into the Owncast server repo.

```
.
├── sdks/
│   └── js/                @owncast/plugin-sdk — npm package for authors
│       ├── index.js              runtime: definePlugin(), host.* wrappers
│       ├── index.d.ts            TypeScript types for editor autocomplete
│       ├── bin/                  owncast-plugin build CLI
│       ├── scripts/              postinstall fetches extism-js + binaryen
│       └── create-owncast-plugin/  npm initializer (`npm create owncast-plugin`)
│
├── host-runtime-poc/      Go: PoC host runtime — moves to the Owncast server
│   │                              repo when integration lands
│   ├── plugin/            runtime library: manager, dispatcher, server, host-fns
│   │   └── testing/       scenario runner used by the test binary
│   ├── kv/                Store interface + bbolt and in-memory impls
│   ├── cmd/owncast-plugin-test/    standalone test runner CLI
│   ├── cmd/owncast-plugin-serve/   localhost dev HTTP server CLI
│   └── main.go            demo: simulated chat stream against the runtime
│
├── examples/
│   └── js/                one JS example per architectural feature (see below)
├── plugins/               .ocpkg packages the demo host loads (build artifacts, gitignored)
├── tools/                 prebuilt extism-js, wasm-merge, wasm-opt, Go binaries
└── docs/                  guides + wire protocol + roadmap
```

## Architecture in one screen

- **Manifest is the source of truth** — `plugin.manifest.json` declares name, version, subscriptions (notify/filter), and permissions. The host compares it against the plugin's runtime `register()` output at load; mismatches are rejected.
- **Typed handlers per event** — instead of one `onEvent(event)` with a string switch, plugins define methods like `onChatMessage(msg)` and `filterChatMessage(msg)`. The SDK derives the manifest's subscriptions from which methods are present, so the author maintains a single source of truth.
- **`on: { ... }` for custom events** — plugin-emitted events (e.g. `"announcement.broadcast"`) are subscribed to via a keyed object. Authors define their own constants for these strings.
- **Notifications vs filters**:
  - `on*` handlers — fire-and-forget, plugins run in parallel
  - `filter*` handlers — sequential, priority-ordered, return `filter.pass()` / `.modify(payload)` / `.drop(reason)`. Errors **fail open**.
  - Plugin → host calls via `owncast.chat.send`, `owncast.kv.{get,set}`, `owncast.events.emit`, `owncast.http.fetch` — gated by declared permissions. For HTTP, `network.fetch` permission grants Extism's `AllowedHosts: ["*"]`; finer-grained allow-listing is deferred.
- **Plugins can serve HTTP** — under `/plugins/<name>/*`, static assets are served directly; unmatched paths fall through to the plugin's `onHttpRequest(req)` handler. Requires `http.serve` permission. Default-public; gate admin-only features on `req.authenticated`. Response headers are filtered through an allowlist (no `Set-Cookie` etc.); request and response bodies are size-capped.
- **Two distribution formats:**
  - **Loose files** — `<name>.wasm` + `<name>.manifest.json` + optional `<name>-assets/` dropped into `plugins/`. Easy to inspect and iterate during dev.
  - **Single-file `.ocpkg` packages** — a zip with `plugin.manifest.json` + `plugin.wasm` + optional `assets/`. Built via `owncast-plugin package`. Drop one file into `plugins/`, restart, done. Recommended for distribution.
- **Plugin → plugin** via `owncast.events.emit(type, payload)` — the emitted event re-enters the dispatcher and fans out to subscribers. Recursion is capped at `MaxEmitDepth = 8`.
- **Per-plugin instance** — Extism plugin instances are reused across calls. Calls into a single plugin are mutex-serialized; different plugins run concurrently.
- **KV is namespaced per-plugin** — bbolt bucket per plugin name; plugins can't read each other's keys.

## Run the demo

```sh
# Build the Go-side binaries this repo owns (one-time, after cloning)
tools/bootstrap.sh

# Build each example into ./plugins/  (npm install fetches extism-js et al.
# via the SDK's postinstall on first run)
for ex in examples/js/*/; do tools/build-plugin.sh "$ex"; done

# Run the simulated chat stream
cd host-runtime-poc && go run . ../plugins
```

`tools/bootstrap.sh` compiles `owncast-plugin-test` and `owncast-plugin-serve` from `host-runtime-poc/cmd/`. End users installing the published SDK get these as per-platform release-asset downloads via the postinstall instead — `bootstrap.sh` is for repo developers running against a not-yet-released checkout.

You should see the chat stream flow through the filter chain (slow-mode, buggy-filter, profanity-filter), then fan out to notification subscribers (chat-logger, echo-bot, message-counter, relay), with relay re-emitting `announcement.broadcast` events that announcer handles.

## Run all example tests

```sh
for ex in examples/js/*/; do tools/owncast-plugin-test "$ex"; done
```

Or `cd examples/js/<name> && npm test` for a single plugin (which also rebuilds it first).

## Authoring a plugin

```sh
npx create-owncast-plugin my-plugin
cd my-plugin
npm install                       # postinstall fetches extism-js + binaryen
npm run build                     # produces my-plugin.wasm
npm test                          # runs scenario tests in __tests__/
npm run serve                     # localhost dev server at http://localhost:8080/plugins/my-plugin/
npx owncast-plugin package        # produces my-plugin.ocpkg — single-file distributable
```

Author code goes in `src/plugin.js`. Edit `plugin.manifest.json` to declare permissions (subscriptions are derived from your handler methods). The TypeScript declarations in `@owncast/plugin-sdk` give editor autocomplete. Static assets — HTML pages, images, JS — go in `assets/`; they're served at `/plugins/<name>/...`.

## Testing

Plugins are tested against the actual built `.wasm` using the **same plugin runtime code that the production Owncast app uses** — so passing tests guarantee the same code path passes in production. No Owncast restart, no live stream needed.

Tests are JSON scenarios in `__tests__/*.test.json`:

```json
[
  {
    "name": "echoes the message back",
    "events": [
      { "event": "chat.message.received",
        "payload": { "user": "alice", "body": "hi" } }
    ],
    "expect": { "chatSends": ["alice said: hi"] }
  },
  {
    "name": "rate-limits same user within 2s",
    "given": { "kv": { "last:alice": "1704067200000" } },
    "events": [
      { "filter": "chat.message.received",
        "payload": { "user": "alice", "body": "spam", "timestamp": "2024-01-01T00:00:01Z" },
        "expect": { "action": "drop", "reason": "/slow-mode/" } }
    ]
  }
]
```

Available step types:
- `event: "<type>"` — fire-and-forget notification dispatch
- `filter: "<type>"` — filter chain; inline `expect: {action, payload?, reason?}`
- `http: { method, path, headers, body, expect: {status, headers?, body?} }` — sends request through the same `plugin.Server` production uses

Available assertions:
- Per-step `expect.action` / `expect.payload` / `expect.reason` for filter steps; `http.expect` for HTTP steps
- Final-state `expect.chatSends` (exact list), `expect.emits` (exact list of `{eventType, payload}`), `expect.kv` (partial map), `expect.httpRequests` (outbound HTTP from the plugin)
- Pre-state `given.kv` (initial KV namespace), `given.httpResponses` (canned HTTP responses for outbound `owncast.http.fetch` calls)

The runner is the `owncast-plugin-test` binary. For JS plugins, `npm test` invokes it via the SDK CLI. Non-JS plugin authors install the binary directly.

Minimum plugin:

```js
const { definePlugin, owncast, filter } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  // Notification handler — typed payload, no string switching.
  onChatMessage(msg) {
    owncast.chat.send(`echo: ${msg.body}`);
  },

  // Filter handler — return filter.pass() / .modify() / .drop().
  filterChatMessage(msg) {
    return msg.body.includes("spam") ? filter.drop("spam") : filter.pass();
  },

  // Custom plugin-emitted events.
  on: {
    "announcement.broadcast"(payload) {
      console.log(`announcement from ${payload.by}: ${payload.text}`);
    }
  }
});
```

## Examples

See **[examples/js/README.md](./examples/js/README.md)** for the full catalog of plugin examples with one-line summaries. Each example has its own README inside its directory.

## Open items / not yet done

- **Owncast integration**: the host runtime in `host-runtime-poc/` is PoC scaffolding. The real home is the Owncast server repo; the wire interface in [`docs/WIRE_PROTOCOL.md`](./docs/WIRE_PROTOCOL.md) is the contract between the two repos.
- **Real auth wiring**: `req.authenticated` is always `false` in the demo binary because the demo doesn't have user sessions. The host's auth gate works (admin paths return 401 without it) but production needs hooking into Owncast's existing session / admin-key machinery.
- **Manager persistence**: the enabled-plugin set is stored at `<pluginsDir>/.enabled.json` for the PoC. Real Owncast integration should write to its native config store.
- **HTTP allow-listing**: `network.fetch` currently grants any host (including `localhost`, which is an SSRF risk against Owncast's own admin API). A manifest field like `"network": { "allowedHosts": ["*.weather.com"] }` would let admins narrow this per plugin. Worth doing before a marketplace.
- **Config**: `manifest.config` schema is parsed but no host function exposes config values to plugin code. Intent is typed config values per plugin, editable from the Owncast admin UI.
- **Strike system for notifications + HTTP**: the filter chain auto-disables a plugin after 5 consecutive failures. The notification and HTTP handler paths have per-call timeouts but don't count strikes — a permanently-broken `onChatMessage` keeps getting called forever.
- **Action button HTML sanitization**: action buttons with an `html` field ship the HTML verbatim. The Owncast frontend renders trusted external-action HTML today; once these come from plugins, server-side sanitization (or a tighter allowlist) is worth considering.
- **Bootstrap binaries via GitHub releases**: `owncast-plugin-test` and `owncast-plugin-serve` are committed in `tools/` for the PoC. Real distribution is GitHub releases of this repo, fetched by `sdks/js/scripts/postinstall.js` alongside `extism-js`.
- **Additional language SDKs**: `sdks/go/` and `sdks/python/` are planned. They'll implement the same wire protocol and consume the shared scenario test corpus and release binaries.
- **Drop-a-JS-file authoring**: the eventual dream is for the host to embed the JS-to-wasm compiler so authors can ship `.js` directly. Today the build step is mandatory.
