#!/usr/bin/env bash
# Compile a plugin example into ./plugins/.
#
# Two project shapes are supported:
#  - SDK-based (recommended): has a package.json with `owncast-plugin build`.
#    Runs `npm install` (once) and `npm run build`.
#  - Raw: has plugin.js + index.d.ts at the example root. Runs extism-js
#    directly. Kept for low-level demos.
#
# Usage: tools/build-plugin.sh examples/<name>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/tools"
PATH="$TOOLS:$PATH"

if [ $# -ne 1 ]; then
  echo "usage: $0 examples/<plugin-dir>" >&2
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
    npm run --silent build
  )
else
  (
    cd "$SRC"
    "$TOOLS/extism-js" plugin.js -i index.d.ts -o "$NAME.wasm"
  )
fi

cp "$SRC/$NAME.wasm" "$ROOT/plugins/$NAME.wasm"
cp "$SRC/plugin.manifest.json" "$ROOT/plugins/$NAME.manifest.json"
# Deploy static assets (canonical layout: <name>-assets/ next to wasm).
if [ -d "$SRC/assets" ]; then
  rm -rf "$ROOT/plugins/$NAME-assets"
  cp -R "$SRC/assets" "$ROOT/plugins/$NAME-assets"
fi
echo "deployed: $NAME"
