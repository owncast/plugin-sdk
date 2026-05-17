# owncast-plugins (PoC)

Standalone proof-of-concept exploring an in-process plugin system for [Owncast](https://owncast.online): JavaScript plugins compiled to WebAssembly, executed inside a Go host via [Extism](https://extism.org) (which uses [Wazero](https://wazero.io) — pure Go, no CGo).

This isn't part of Owncast yet. It's a sandbox to validate the architecture.

## Documentation

- **[Plugin Author Guide](./docs/PLUGIN_AUTHOR_GUIDE.md)** — start-to-finish guide for writing, testing, and shipping a plugin
- **[Host API Roadmap](./docs/HOST_API_ROADMAP.md)** — catalog of Owncast capabilities to expose to plugins (what's shipped, planned, deferred)
- **[TODO / Open Ideas](./docs/TODO.md)** — design ideas and concrete work items still on the punch list

## What's here

```
.
├── owncast/               Go module — production plugin runtime + demo + tools
│   ├── plugin/            runtime library: manager, dispatcher, server, host-fns, perms
│   │   └── testing/       scenario runner used by the test binary
│   ├── kv/                Store interface + bbolt and in-memory impls
│   ├── cmd/owncast-plugin-test/    standalone test runner CLI
│   ├── cmd/owncast-plugin-serve/   localhost dev HTTP server CLI
│   └── main.go            demo: simulated chat stream against the runtime
│
├── sdk/                   @owncast/plugin-sdk — npm package for authors
│   ├── index.js           runtime: definePlugin(), host.* wrappers
│   ├── index.d.ts         TypeScript types for editor autocomplete
│   ├── bin/               owncast-plugin build CLI
│   └── scripts/           postinstall fetches extism-js + binaryen
│
├── create-owncast-plugin/ npm initializer (`npm create owncast-plugin <name>`)
│   ├── bin/               scaffolder
│   └── template/          starter project
│
├── examples/              one example per architectural feature (see below)
├── plugins/               built .wasm + .manifest.json pairs the host loads
└── tools/                 prebuilt extism-js, wasm-merge, wasm-opt for dev
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

Build all the example plugins and start the host:

```sh
# Build each example into ./plugins/
for ex in examples/*/; do tools/build-plugin.sh "$ex"; done

# Run the simulated chat stream
cd owncast && go run . ../plugins
```

You should see the chat stream flow through the filter chain (slow-mode, buggy-filter, profanity-filter), then fan out to notification subscribers (chat-logger, echo-bot, message-counter, relay), with relay re-emitting `announcement.broadcast` events that announcer handles.

## Run all example tests

```sh
for ex in examples/*/; do tools/owncast-plugin-test "$ex"; done
```

Or `cd examples/<name> && npm test` for a single plugin (which also rebuilds it first).

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

All examples use `@owncast/plugin-sdk`. Each `examples/<name>/` is a self-contained npm project — `tools/build-plugin.sh` runs `npm install` + `npm run build` for each.

| Plugin | Demonstrates |
|---|---|
| `hello-world` | Minimal — manifest + `register()` validation, no handlers |
| `chat-logger` | `onEvent` notification fanout |
| `echo-bot` | `owncast.chat.send` |
| `message-counter` | `owncast.kv.get` / `set`, persistence across restarts |
| `profanity-filter` | `onFilter` returning `filter.modify(...)` |
| `slow-mode` | `onFilter` returning `filter.drop(reason)`, with KV-backed state |
| `buggy-filter` | Fail-open: throws each call, chain continues unaffected |
| `relay` + `announcer` | Plugin → plugin custom events via `owncast.events.emit` |
| `ip-bot` | `owncast.http.fetch` — real HTTP, mocked in tests via `given.httpResponses` |
| `overlay` | `http.serve` permission — static `assets/index.html` + dynamic `/api/messages` JSON endpoint, both at `/plugins/overlay/` |
| `stream-tracker` | Every typed event handler (stream lifecycle + chat user join/part/rename), read APIs (`owncast.stream.current()`, `owncast.server.info()`), chat variants (`sendAction`, `sendAs`) |
| `mod-bot` | Chat moderation (`owncast.chat.deleteMessage`), notifications (`owncast.notifications.discord`, `.browserPush`), fediverse events + outbound `owncast.fediverse.post(text)` |
| `admin-demo` | Admin UI integration — `manifest.admin.pages` declares auth-gated routes; static settings page + JSON config API behind admin auth |

Filter failures track strike counts: a plugin whose `filterChatMessage` throws 5 times in a row is auto-disabled for the rest of the session. A successful filter call resets the counter.

## Open items / not yet done

- **HTTP allow-listing**: `network.fetch` currently grants any host (including localhost). For a marketplace-distribution future, a manifest field like `"network": { "allowedHosts": ["*.weather.com"] }` could narrow this for plugins that don't legitimately need full reach. Skipped for now — see the design discussion in commit history.
- **First-class host functions for Owncast state**: plugins that want stream/user/chat-history data currently could only get it by calling `localhost`. Each common need should become a proper host function (`owncast.stream.current()`, etc.) over time.
- **Per-route admin auth declarations**: HTTP endpoints default to public, with plugins gating admin features via `req.authenticated`. A manifest field like `"http": { "adminPaths": ["/admin/*"] }` could let the host enforce auth before the request reaches the plugin. Defer until a marketplace.
- **Real Owncast auth integration**: `req.authenticated` is currently always `false` in the PoC because there's no auth in the demo binary. Wire to Owncast's existing session/admin-key machinery when integrating.
- **Filter priority**: with subscriptions auto-derived, every filter currently runs at priority 0. The chain still works — filters just may run in alphabetical (plugin name) order rather than the most-efficient order. Need an API to set per-plugin filter priority (in `definePlugin({ filterPriority: 30, ... })` or in the manifest).
- **Strike system**: design says repeatedly-failing plugins auto-disable. Today, a buggy filter logs every time it fails. Cheap to add (counter + threshold on `Loaded`).
- **Filter timeouts**: 50ms per-plugin, 200ms chain budget per the design. Needs Wazero context-aware execution; deferred.
- **Network host function**: `host.fetch()` for `network.fetch` permission. Not implemented.
- **Config**: `manifest.config` schema is parsed but not exposed to plugins yet. Intent: typed config values per plugin, editable in the Owncast admin UI.
- **Owncast integration**: this PoC simulates the chat stream in `host/main.go`. Wiring into real Owncast events comes after the design is validated.
- **Drop-a-JS-file authoring** (the v1.0 dream from our design discussion): host embeds the JS-to-wasm compiler so authors don't run a build step. Step 6 here uses the npm path instead — still requires `npm run build`. Future work.
