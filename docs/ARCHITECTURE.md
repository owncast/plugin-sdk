# SDK architecture

A system-level tour of what's in this repository and how the pieces fit
together. This is informational, for writing a plugin, see the
[Plugin Author Guide](./PLUGIN_AUTHOR_GUIDE.md); for the byte-level host/plugin
protocol, see the [Wire Protocol](./WIRE_PROTOCOL.md).

## What this repo is

This repository is where the Owncast plugin system is developed. It contains:

- the **host runtime** (Go) that loads and runs plugins,
- the **JavaScript SDK** authors write plugins against, plus the build CLI and a
  project scaffolder,
- the **toolchain** that compiles a plugin to WebAssembly,
- **example plugins** and their tests.

The host runtime is also the code that gets vendored into the Owncast server to
run plugins in production. So this repo is both the SDK _and_ the reference host;
Owncast embeds a copy of `host-runtime/plugin` (see
[Relationship to Owncast](#relationship-to-owncast)).

## Execution model

A plugin is authored in JavaScript/TypeScript and compiled to a WebAssembly
module by [`extism-js`](https://github.com/extism/js-pdk) (which embeds a QuickJS
interpreter). The host loads that module with [Extism](https://extism.org), built
on [Wazero](https://wazero.io), a pure-Go wasm runtime (no CGo, no subprocess).

- The plugin exports a fixed set of functions: `register`, `on_event`,
  `on_filter`, `on_http_request`.
- The host provides **host functions** (`owncast_*`) the plugin may import, but
  only the ones its manifest's **permissions** allow. Importing an ungranted
  host function fails at instantiation, so permissions are enforced structurally,
  not just by convention.
- Everything crosses the boundary as JSON.

## Repository layout

```
host-runtime/            Go module: the host runtime + the two Go CLIs
  plugin/                the runtime library (see below)
  cmd/owncast-plugin-serve/   localhost dev server
  cmd/owncast-plugin-test/    scenario test runner
  main.go                a demo host that simulates a stream
sdks/js/                 @owncast/plugin-sdk, the npm package
  index.js               definePlugin() + the owncast.* host wrappers
  index.d.ts             TypeScript types (the author-facing contract)
  bin/owncast-plugin.js  the build/package/test/serve CLI
  scripts/postinstall.js fetches the toolchain binaries
  create-owncast-plugin/ npm initializer (scaffolder)
examples/js/             one self-contained example plugin per directory
tools/                   toolchain binaries (fetched/built; gitignored)
docs/                    these documents
.github/workflows/       release workflow for the Go binaries
```

## The host runtime (`host-runtime/plugin`)

The core library. Key files:

- **`manager.go`**, discovers plugins in a directory, tracks them as
  _discovered_ vs _enabled_, and handles enable/disable/reload. The enabled set
  persists through a pluggable `EnabledStore` (a JSON file by default; Owncast
  swaps in a datastore-backed store).
- **`dispatcher.go`**, fans events out to subscribed plugins' `on_event`
  handlers and runs `on_filter` chains (used for chat filtering).
- **`server.go`** + **`sse.go`**, serve `/plugins/<name>/*` (static assets +
  the plugin's `on_http_request`) and a host-owned Server-Sent-Events endpoint
  the plugin pushes to.
- **`hostfns.go`**, the heart of the contract: the host-function definitions,
  the **permission** constants, and the **types** plugins receive. Every host
  function reads a function-pointer field from a `HostEnv` struct.
- **`kv/`**, the key/value store interface plugins get (memory + bolt
  implementations here; Owncast backs it with its datastore).
- **`testing/`**, a mock host (`MockHost`) and the scenario runner used by
  `owncast-plugin-test`.

### `HostEnv` is the integration seam

`hostfns.go` is intentionally host-agnostic. A host function like
`owncast_video_config_read` just calls `env.VideoConfig()`, a field on
`HostEnv`. `BuildHostFunctions` assembles the host functions a plugin gets based
on its declared permissions. **Whoever embeds the runtime fills in `HostEnv`**
with real data. Four hosts do this today:

| Host                          | `HostEnv` is backed by               | Used for                 |
| ----------------------------- | ------------------------------------ | ------------------------ |
| `host-runtime/main.go`        | a hardcoded simulated stream         | demo/playground          |
| `cmd/owncast-plugin-serve`    | in-memory dev stubs + a dev chat log | local plugin development |
| `plugin/testing` (`MockHost`) | scenario-supplied fixtures           | `owncast-plugin-test`    |
| Owncast `pluginhost`          | real Owncast services                | production               |

All four expose the _same_ host functions and types; only the data behind
`HostEnv` differs. That's what lets a plugin built once run identically in tests,
the dev server, and production.

## The plugin API contract

The plugin-facing API exists in three representations that must agree:

1. **Go**, the host functions, permissions, and types in
   `host-runtime/plugin/hostfns.go`.
2. **TypeScript**, the `owncast.*` wrappers in `sdks/js/index.js` and the types
   in `sdks/js/index.d.ts`, which authors code against.
3. **`host-runtime/plugin/plugin-contract.json`**, a generated snapshot of (1):
   permission identifiers, host-function names, and the field shapes of every
   wire type. It does nothing at runtime; it's a fingerprint.

Two tests guard against drift:

- **`sdk_drift_test.go`**, every `owncast_*` host function in `hostfns.go` must
  be referenced in both `index.js` and the build CLI's import generator.
- **`contract_test.go`**, re-derives the snapshot from `hostfns.go` and compares
  it to `plugin-contract.json` (field shapes included). Regenerate after an
  intentional change with `UPDATE_CONTRACT=1 go test ./plugin/ -run TestPluginContract`.

The snapshot is also the artifact consumers vendor: Owncast keeps a copy and
runs its own contract test against it, so its embedded runtime can't silently
fall behind. See the [Wire Protocol](./WIRE_PROTOCOL.md) for the byte-level
contract these three representations encode.

## Toolchain and build flow

`owncast-plugin build` (in `sdks/js/bin/owncast-plugin.js`) turns a plugin
project into a `.wasm`:

1. **esbuild** bundles the author's `src/plugin.{ts,js}` + the SDK runtime into a
   single CommonJS file targeting QuickJS.
2. **`extism-js`** compiles that bundle to wasm, using a generated
   `index.d.ts` that declares exactly the host imports the manifest's permissions
   allow.
3. **binaryen** (`wasm-merge`/`wasm-opt`) post-processes the module.
4. `owncast-plugin package` zips the manifest + wasm + `assets/` into a single
   `.ocpkg`.

The toolchain binaries are fetched by the npm `postinstall`
(`sdks/js/scripts/postinstall.js`) into `sdks/js/bin/.cache`:

- `extism-js` from [extism/js-pdk](https://github.com/extism/js-pdk) releases,
- `wasm-merge`/`wasm-opt` from [binaryen](https://github.com/WebAssembly/binaryen)
  releases,
- `owncast-plugin-test` and `owncast-plugin-serve` from **this repo's** GitHub
  releases (they're Go binaries built from `host-runtime/`). `tools/bootstrap.sh`
  builds them locally for development.

`.github/workflows/release.yml` cross-compiles those two Go binaries (pure Go,
`CGO_ENABLED=0`) for linux/darwin × amd64/arm64 on every `v*` tag and uploads
them as release assets named to match what `postinstall.js` downloads.

## Command-line tools

- `owncast-plugin build` / `package`, compile / bundle a plugin.
- `owncast-plugin test`, run `__tests__/*.test.json` scenarios against a built
  plugin (delegates to the `owncast-plugin-test` Go binary, which uses the real
  runtime with `MockHost`).
- `owncast-plugin serve`, run one plugin behind a localhost dev server
  (`owncast-plugin-serve`), with stubbed host data and dev endpoints to drive
  chat/events into the plugin.

## Testing

- **Scenario tests** (`*.test.json`) describe `given` state, `events`/`http`
  steps, and `expect` assertions; the runner loads the real wasm with `MockHost`,
  so passing here means the same code path passes in production.
- **Go tests** cover the runtime packages (`manager`, `dispatcher`, `server`,
  `sse`, `testing`).
- **Contract/drift tests** keep the Go/TS/snapshot representations aligned.

## Relationship to Owncast

The runtime (`host-runtime/plugin`) is **vendored into Owncast** as
`services/plugins/`, where Owncast wires `HostEnv` to its real services. The
implementation is allowed to fork for integration, but the API surface in
`hostfns.go` must match this repo, enforced by Owncast's copy of
`plugin-contract.json` and its contract test. The host-side details (wiring,
the sync workflow) are documented in the Owncast repo at `docs/plugins.md`.
