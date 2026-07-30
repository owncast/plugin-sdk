# Self-contained wasm examples

Plugins authored directly as a wasm module: no language SDK, no shared engine,
the module implements the [wire protocol](../../docs/WIRE_PROTOCOL.md) itself.
Any language that compiles to wasm and has an
[Extism PDK](https://extism.org/docs/concepts/pdk) works, including Rust,
TinyGo, AssemblyScript, Zig, and C.

Most plugins should be [JavaScript](../js/) or [Python](../python/) instead. The
SDKs cover the same protocol in a fraction of the code, and their packages are a
few KB against ~100 KB for a compiled module. Reach for a native module when you
want a compiled language, an existing crate, or direct control over the ABI.

| Plugin                      | Language | One-line summary                                                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| [hello-wasm](./hello-wasm/) | Rust     | Minimal native module: echoes its host-injected manifest from `register()`, then replies to chat.        |

The public [Native WebAssembly guide](https://owncast.online/docs/plugins/sdks/native-wasm)
also includes minimal registration examples for TinyGo and AssemblyScript.

Each directory has its own `README.md` with build and test commands.
