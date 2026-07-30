#!/usr/bin/env bash
# Build and package Hello Wasm. Needs a Rust toolchain with the
# wasm32-unknown-unknown target:
#
#   rustup target add wasm32-unknown-unknown
#
# Outputs, both gitignored:
#   hello-wasm.wasm    loose layout that owncast-plugin-test discovers next to
#                      plugin.manifest.json, and what a server's plugins/
#                      directory accepts as a loose drop-in
#   hello-wasm.ocpkg   installable package. Inside the zip the code entry has
#                      to be named plugin.wasm regardless of the plugin's slug
set -euo pipefail
cd "$(dirname "$0")"

SLUG=hello-wasm
CRATE=${SLUG//-/_}

cargo build --locked --release --target wasm32-unknown-unknown
cp "target/wasm32-unknown-unknown/release/$CRATE.wasm" "$SLUG.wasm"

rm -f "$SLUG.ocpkg"
cp "$SLUG.wasm" plugin.wasm
zip -q "$SLUG.ocpkg" plugin.wasm plugin.manifest.json
rm -f plugin.wasm

echo "built $SLUG.wasm + $SLUG.ocpkg"
