# hello-wasm

A minimal Owncast plugin authored directly as a self-contained wasm module.
There's no JavaScript/Python SDK and no shared engine in the picture:
[`src/lib.rs`](./src/lib.rs) implements the
[wire protocol](../../../docs/WIRE_PROTOCOL.md) itself with two exports
(`register`, `on_event`) and one host import (`owncast_send_chat`).

**Demonstrates:** the native-wasm load path, reading the reserved `manifest`
Extism config key, manifest-declared `subscriptions`, and posting to chat from a
hand-written module.

## Where the manifest comes from

The host injects the packaged `plugin.manifest.json` under the reserved
`manifest` config key on every runtime, so `register()` here is a one-liner: read
that value and hand it straight back. The alternative is to `include_str!` the
manifest into the module, which compiles in a second copy that can drift from
what actually shipped in the `.ocpkg`.

Because no SDK is deriving anything at runtime, the subscriptions are declared in
`plugin.manifest.json` and echoed along with the rest of it. The host then
installs exactly those, and gates the permission-carrying ones against the
manifest's `permissions`.

Identity is the one field not to read from the manifest: the sibling `__slug`
config key carries the slug as the host resolved it, which is authoritative when
a manifest leaves `slug` out and lets the host derive it from `name`.

## Build

```sh
rustup target add wasm32-unknown-unknown   # once
./build.sh
```

That writes two gitignored artifacts:

- `hello-wasm.wasm`, the module used by `owncast-plugin-test`. The test runner
  finds it beside the project's `plugin.manifest.json`.
- `hello-wasm.ocpkg`, the installable package. Inside the ZIP, the code entry
  must be named `plugin.wasm` regardless of the slug. That filename tells the
  host which runtime to use.

For a loose server installation, copy the module and manifest into Owncast's
`data/plugins/` directory with the same basename:

```text
hello-wasm.wasm
hello-wasm.manifest.json
```

## Test

```sh
../../../tools/owncast-plugin-test .
```

(`tools/bootstrap.sh` builds that binary if it isn't there yet.) It runs the
install-time load check a real server performs, including `register()`,
manifest/runtime agreement, and permission-gated subscriptions. It then runs
the scenarios in [`__tests__/`](./__tests__/) through the same host runtime
Owncast uses in production.
