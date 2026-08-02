# SDK architecture

A system-level tour of what's in this repository and how the pieces fit
together. This is informational, for writing a plugin, see the
[Plugin Author Guide](./PLUGIN_AUTHOR_GUIDE.md). For the byte-level host/plugin
protocol, see the [Wire Protocol](./WIRE_PROTOCOL.md).

## What this repo is

This repository is where the Owncast plugin system is developed. It contains:

- the **JavaScript and Python SDKs** authors write plugins against, plus the
  build CLIs and a project scaffolder,
- the **shared interpreter engines** (one per language) and the toolchain that
  builds them,
- the **host runtime** (Go) that loads and runs plugins. The runtime itself now
  lives in Owncast (`services/plugins`) and is imported here (see
  [Relationship to Owncast](#relationship-to-owncast)),
- **example plugins** (parallel JS and Python ports) and their tests.

## Execution model

Plugins are authored in **JavaScript/TypeScript or Python**. Rather than each
plugin compiling its own interpreter into a self-contained module, the host
embeds **one shared engine per language**, a QuickJS (JS) or CPython (Python)
interpreter compiled to WebAssembly with the Extism PDK
([`extism-js`](https://github.com/extism/js-pdk) /
[`extism-py`](https://github.com/extism/python-pdk)). The host compiles each
engine **once** with [Extism](https://extism.org) on [Wazero](https://wazero.io)
(pure-Go wasm, no CGo/subprocess) and **instantiates it per plugin**, injecting
the plugin's source via Extism config at load. This collapses per-plugin memory
(N plugins share one compiled engine instead of N copies) and shrinks plugin
packages from megabytes to a few KB.

A plugin authored directly as a self-contained wasm module (Rust/Go/etc.) is
also supported and loaded as-is. The host picks the path from the package's code
file (see [build flow](#toolchain-and-build-flow)).

- Every plugin exports the same fixed functions: `register`, `on_event`,
  `on_filter`, `on_http_request`, `on_tab_content`, `on_page_content`,
  `on_page_styles`, `on_page_scripts`, and `on_auth_check`. Most are optional.
  See the [Wire Protocol](./WIRE_PROTOCOL.md) for the full table and which
  permissions gate them.
- The host provides **host functions** (`owncast_*`). Because all plugins of a
  language share one engine, the engine imports the full set and the host
  enforces each plugin's **permissions at call time**: a host function resolves
  the calling plugin's identity (from a per-instance config value) and rejects
  the call if the plugin's manifest didn't grant the permission.
- Pointer payloads carry JSON, UTF-8 text, or raw bytes. Some host imports use
  scalar `I64` values.
- Inbound Fediverse hooks are internal notify subscriptions. They are not
  external HTTP webhooks. Owncast verifies the HTTP signature and actor origin,
  then sends the raw activity to `onFediverse` / `on_fediverse` and also sends
  any matching specialized follow, like, repost, quote, mention, or reply event.
  The `fediverse.inbound` manifest permission gates all seven subscriptions.

## Repository layout

```
host-runtime/            Go module: imports the runtime + builds the two Go CLIs
  cmd/owncast-plugin-serve/   localhost dev server
  cmd/owncast-plugin-test/    scenario test runner
  main.go                a demo host that simulates a stream
sdks/js/                 @owncast/plugin-sdk, the npm package
  index.js               definePlugin(), command handlers + owncast.* wrappers
  index.d.ts             TypeScript types (the author-facing contract)
  bin/owncast-plugin.js  the build/package/test/serve CLI
  scripts/postinstall.js fetches the test/serve binaries
  create-owncast-plugin/ npm initializer (scaffolder)
sdks/python/             owncast-plugin-py: the Python SDK + build CLI
engines/                 the shared engines' fixed bootstrap + build scripts
  javascript/entry.js    the JS engine bootstrap (SDK + dispatch + script loader)
  build.mjs, build_py.py  build the engine wasms, copy them into Owncast's embed dir
examples/js/, examples/python/   parallel example plugins (one dir per plugin)
tools/                   engine-build toolchain (extism-js/py, binaryen; gitignored)
docs/                    these documents
.github/workflows/       release workflow for the Go binaries
```

## The host runtime (`services/plugins`)

The core library. It lives in the Owncast repo (`services/plugins`) as the
single source of truth, and `host-runtime/` here imports it so the dev CLIs run
the exact production code. Key files:

- **`manager.go`**, discovers plugins in a directory, tracks them as
  _discovered_ vs _enabled_, and handles enable/disable/reload. The enabled set
  persists through a pluggable `EnabledStore` (a JSON file by default. Owncast
  swaps in a datastore-backed store).
- **`dispatcher.go`**, fans ordinary events out to subscribed plugins, delivers
  targeted internal events, and runs `on_filter` chains.
- **`server.go`** + **`sse.go`**, serve `/plugins/<name>/*` (static assets +
  the plugin's `on_http_request`) and a host-owned Server-Sent-Events endpoint
  the plugin pushes to.
- **`hostfns.go`**, the heart of the contract: the host-function definitions,
  the **permission** constants, and the **types** plugins receive. Every host
  function reads a function-pointer field from a `HostEnv` struct and resolves
  the **calling plugin's identity + permission at call time** (see `registry.go`).
- **`engines/`** + **`engine_cache.go`**, the embedded per-language engine wasms
  (`go:embed`) and the cache that compiles each once and instantiates it per
  plugin.
- **`registry.go`**, the per-plugin identity registry shared host functions look
  up to scope a call (slug, granted permissions, kv namespace, assets). It is the
  call-time replacement for the old per-plugin closures.
- **`commands.go`**, matches accepted chat messages against every plugin's
  command declarations, applies moderator gates and cooldowns, and dispatches
  the internal `chat.command` event to every match.
- **`help.go`**, the host-owned unified `!help`: aggregates each plugin's
  reported command metadata and renders the listing.
- **`kv/`**, the key/value store interface plugins get (memory + bolt
  implementations here. Owncast backs it with its datastore).
- **`testing/`**, a mock host (`MockHost`) and the scenario runner used by
  `owncast-plugin-test`.

### `HostEnv` is the integration seam

`hostfns.go` is intentionally host-agnostic. A host function like
`owncast_video_config_read` just calls `env.VideoConfig()`, a field on
`HostEnv`. `BuildHostFunctions` assembles the full host-function set and each
call checks the plugin's declared permissions. **Whoever embeds the runtime
fills in `HostEnv`** with real data. Four hosts do this today:

| Host                          | `HostEnv` is backed by               | Used for                 |
| ----------------------------- | ------------------------------------ | ------------------------ |
| `host-runtime/main.go`        | a hardcoded simulated stream         | demo/playground          |
| `cmd/owncast-plugin-serve`    | in-memory dev stubs + a dev chat log | local plugin development |
| `plugin/testing` (`MockHost`) | scenario-supplied fixtures           | `owncast-plugin-test`    |
| Owncast `pluginhost`          | real Owncast services                | production               |

All four expose the _same_ host functions and types. Only the data behind
`HostEnv` differs. That's what lets a plugin built once run identically in tests,
the dev server, and production.

`storage.sql` is the one place where the host, not just the data behind it,
differs. The three non-production hosts share `host-runtime/sqlstore`, which
gives each plugin a private in-memory SQLite database and runs every request
through the same `plugins.SQLRunner` Owncast uses, so request validation,
parameter typing, the call timeout, atomic `exec`, and the row, value, result,
and database-size limits all match. It uses `modernc.org/sqlite` rather than the
cgo `mattn/go-sqlite3` driver Owncast uses, because these binaries are
cross-compiled for every release target with `CGO_ENABLED=0`.

Owncast additionally installs a SQLite authorizer to deny `ATTACH`, `DETACH`,
every `PRAGMA`, and temp-schema DDL, and the pure-Go driver has no equivalent.
That difference is not left visible to plugins: those statements are refused
above the driver by `plugins.DeniedSQLReason`, which every host applies at the
host-function boundary, so a plugin gets the same refusal locally that it gets
on a real server. `plugins.DeniedSQLStatementExamples` is the fixture both
repositories test against, this one through the Go check and Owncast through
the authorizer, which is what keeps the two in step.

## The plugin API contract

The plugin-facing API exists in three representations that must agree:

1. **Go**, the host functions, permissions, and types in Owncast's
   `services/plugins/hostfns.go`. The runtime lives in the Owncast repo (see
   [Relationship to Owncast](#relationship-to-owncast)), and this SDK imports it.
2. **TypeScript**, the `owncast.*` wrappers in `sdks/js/index.js` and the types
   in `sdks/js/index.d.ts`, which authors code against.
3. **`services/plugins/plugin-contract.json`**, a generated snapshot of (1):
   permission identifiers, host-function names, and the field shapes of every
   wire type. It does nothing at runtime. It's a fingerprint.

`services/plugins/contract_test.go` guards against drift: it re-derives the
snapshot from `hostfns.go` and compares it to `plugin-contract.json` (field
shapes included). Regenerate after an intentional change with
`UPDATE_CONTRACT=1 go test ./services/plugins/ -run TestPluginContractMatchesSDK`.

The snapshot is the artifact this SDK and other consumers vendor, so an
embedded runtime can't silently fall behind. See the
[Wire Protocol](./WIRE_PROTOCOL.md) for the byte-level contract these three
representations encode.

## Toolchain and build flow

There are two separate builds: the **engines** (built rarely, by maintainers)
and an author's **plugin** (built often, by anyone, with no wasm toolchain needed).

### Building a plugin (what authors run)

Because the interpreter is host-side, an author's build just produces their
**source**, not a wasm module:

- **JS** (`sdks/js/bin/owncast-plugin.js`): `owncast-plugin build` runs **esbuild**
  to bundle `src/plugin.{ts,js}` into a single CommonJS file with
  `@owncast/plugin-sdk` marked _external_ (the SDK lives in the engine), emitting
  `<slug>.js`.
- **Python** (`sdks/python`): the build strips the SDK import line and emits
  `<slug>.py` (the SDK is a global in the engine).

`owncast-plugin package` then zips the manifest + that code file + `public/`
(web-served) + `assets/` (host-read for manifest-inlined content), plus optional
`icon.png` / `INSTRUCTIONS.md`, into a single `.ocpkg`. The code entry is named
by language (**`plugin.js`**, **`plugin.py`**, or **`plugin.wasm`** for a
self-contained module), and the host **infers the runtime from that filename**,
so the manifest needs no `type` field. Authors no longer touch `extism-js`/
`extism-py` or binaryen at all.

### Building the engines (what maintainers run)

`engines/build.mjs` and `engines/build_py.py` compile the fixed bootstrap entry
(SDK runtime + dispatch shim + a loader that reads the plugin's source from
config) into `engine.wasm` per language, via **`extism-js`/`extism-py`** +
**binaryen**, and copy the result into Owncast's embed dir
(`services/plugins/engines/{javascript,python}/engine.wasm`, committed so
Owncast's Go build stays toolchain-free). `make` fetches the engine toolchain
itself (`engines/install-toolchain.mjs` → `engines/.toolchain/`). The
author-facing SDK install does **not** ship any wasm tooling. Rebuild + recommit
when the SDK runtime or bootstrap changes. Full runbook in
[`engines/README.md`](../engines/README.md).

The npm `postinstall` (`sdks/js/scripts/postinstall.js`) fetches just the
`owncast-plugin-test` / `owncast-plugin-serve` Go binaries (built from
`host-runtime/`) for `test`/`serve`. That's all an author's install downloads.
`tools/bootstrap.sh` builds them locally. `.github/workflows/release.yml`
cross-compiles those two (pure Go, `CGO_ENABLED=0`) for linux/darwin ×
amd64/arm64 on every `v*` tag.

## Command-line tools

- `owncast-plugin build` / `package`, bundle a plugin's source into a `.ocpkg`.
- `owncast-plugin test`, run `__tests__/*.test.json` scenarios against a built
  plugin (delegates to the `owncast-plugin-test` Go binary, which uses the real
  runtime with `MockHost`).
- `owncast-plugin serve`, run one plugin behind a localhost dev server
  (`owncast-plugin-serve`), with stubbed host data and dev endpoints to drive
  chat/events into the plugin.

## Testing

- **Scenario tests** (`*.test.json`) describe `given` state, `events`/`http`
  steps, and `expect` assertions. The runner loads the plugin on the real
  embedded engine with `MockHost`, so passing here means the same code path
  passes in production.
- **Go tests** cover the runtime packages (`manager`, `dispatcher`, `server`,
  `sse`, `testing`).
- **Contract/drift tests** keep Owncast's contract snapshot and the shared
  JavaScript and Python import declarations aligned. The host-runtime test
  derives the stack ABI from `plugins.BuildHostFunctions`.

## Relationship to Owncast

The runtime **lives in the Owncast repo** as `services/plugins/`, where Owncast
wires `HostEnv` to its real services. This SDK's `host-runtime/` module imports
it, so the dev CLIs run the exact production runtime. The API surface in
`hostfns.go` has a `services/plugins/plugin-contract.json` snapshot for
permission names, host-function names, and wire types.
`host-runtime/host_function_contract_test.go` separately derives the current
stack signatures from `BuildHostFunctions` and compares the JavaScript and
Python shared engine declarations.

The host-side integration details (wiring, the sync workflow) are documented in
the Owncast repo at `docs/plugins.md`.
