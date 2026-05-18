#!/usr/bin/env bash
# Compile a plugin example into ./plugins/.
#
# Two project shapes are supported:
#  - SDK-based (recommended): has a package.json with `owncast-plugin build`.
#    Runs `npm install` (once) and `npm run build`.
#  - Raw: has plugin.js + index.d.ts at the example root. Runs extism-js
#    directly. Kept for low-level demos.
#
# Usage: tools/build-plugin.sh examples/js/<name>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/tools"
PATH="$TOOLS:$PATH"

if [ $# -ne 1 ]; then
  echo "usage: $0 examples/js/<plugin-dir>" >&2
  exit 1
fi

SRC="$ROOT/$1"
NAME="$(basename "$SRC")"
mkdir -p "$ROOT/plugins"

if [ -f "$SRC/package.json" ]; then
  # Activate nvm-managed node if present and not already on PATH.
  if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh"
    nvm use 24.9 >/dev/null
  fi
  (
    cd "$SRC"
    if [ ! -d node_modules ]; then
      npm install --no-audit --no-fund --silent
    fi
    # `package` runs `build` if the wasm isn't there yet, then bundles
    # manifest + wasm + assets/ into <name>.ocpkg.
    npx --no-install owncast-plugin package >/dev/null
  )
else
  # Raw shape (low-level demos): build with extism-js directly, then hand-zip
  # a minimal .ocpkg. Internal names inside the archive must be the canonical
  # plugin.manifest.json + plugin.wasm regardless of plugin name.
  (
    cd "$SRC"
    "$TOOLS/extism-js" plugin.js -i index.d.ts -o plugin.wasm
    rm -f "$NAME.ocpkg"
    zip -q "$NAME.ocpkg" plugin.wasm plugin.manifest.json
    rm -f plugin.wasm
  )
fi

cp "$SRC/$NAME.ocpkg" "$ROOT/plugins/$NAME.ocpkg"
echo "deployed: $NAME.ocpkg"
