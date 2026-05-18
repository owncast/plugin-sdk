#!/usr/bin/env bash
# Build the two Go-side binaries that aren't yet downloadable: the scenario
# test runner and the localhost dev server. Upstream tooling (extism-js,
# wasm-merge, wasm-opt) is fetched separately by the SDK's npm postinstall,
# so this only covers what comes from this repo's own Go sources.
#
# Run this once after cloning, and again whenever host-runtime-poc/ changes:
#   tools/bootstrap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/host-runtime-poc"

echo "→ building owncast-plugin-test"
go build -o "$ROOT/tools/owncast-plugin-test" ./cmd/owncast-plugin-test

echo "→ building owncast-plugin-serve"
go build -o "$ROOT/tools/owncast-plugin-serve" ./cmd/owncast-plugin-serve

echo "tools/ ready: $(ls "$ROOT/tools" | grep -E '^owncast-plugin-(test|serve)$' | wc -l) binaries built"
