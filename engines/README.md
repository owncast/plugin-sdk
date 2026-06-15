# Regenerating the shared engines (maintainer runbook)

Owncast embeds **one interpreter engine per language** — QuickJS for JavaScript,
CPython for Python — compiled to WebAssembly. The host compiles each engine once
and instantiates it per plugin (injecting the plugin's source via Extism config),
instead of every plugin shipping its own interpreter. See
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#execution-model).

These `engine.wasm` files are **build artifacts committed into the Owncast repo**
at `services/plugins/engines/<language>/engine.wasm` and pulled in with
`go:embed`, so Owncast's Go build never runs this (JS/Python) toolchain. When you
change the engine, you regenerate the wasm here and commit it **in the Owncast
repo**.

## When to regenerate

Regenerate whenever any of these change:

- the SDK runtime — `sdks/js/index.js` or `sdks/python/owncast_plugin/__init__.py`
  (it's bundled into the engine),
- the engine bootstrap — `engines/javascript/entry.js` (JS) or the bootstrap in
  `engines/build_py.py` (Python),
- the host-import union (`engines/javascript/engine.d.ts` / the Python build's
  import block), i.e. when a host function is added or removed.

You do **not** regenerate engines to publish a plugin — author plugins ship
source and run on whatever engine the host already embeds.

## Prerequisites

- **Node** (this repo uses 24.x). `make` fetches the JS engine toolchain
  (`extism-js` + binaryen) itself into `engines/.toolchain/` via
  `install-toolchain.mjs` — you do **not** need `npm install` for this, and the
  author-facing `@owncast/plugin-sdk` install no longer downloads any wasm
  tooling.
- **Python 3** and the `extism-py` toolchain. The Python SDK fetches it on first
  use; running any Python plugin build once (or `owncast-plugin-py build`)
  populates `~/.cache/owncast-plugin-sdk/`. Override the binary with `EXTISM_PY`.

## Regenerate

```sh
cd engines
make            # both engines → ../owncast/services/plugins/engines/{javascript,python}/engine.wasm
make js         # JavaScript only
make python     # Python only
```

The default output target is a sibling `../owncast` checkout. Point it elsewhere
with `OWNCAST_ENGINE_DIR` (the directory that holds the `javascript/` and
`python/` subdirs), or pass a directory as the first arg to `build.mjs` /
`build_py.py`.

## After regenerating

1. **Commit the changed `engine.wasm` in the Owncast repo** (that's where they're
   embedded). Keep them in sync with the SDK runtime version the manifest `api`
   field gates on.
2. The `owncast-plugin-test` / `owncast-plugin-serve` binaries embed the engines
   (via the imported runtime), so rebuild them to test the new engine:
   ```sh
   cd ../host-runtime && go build -o owncast-plugin-test ./cmd/owncast-plugin-test/
   ```
3. Rebuild your example plugins and run the test suite to verify nothing broke in
   either language.
