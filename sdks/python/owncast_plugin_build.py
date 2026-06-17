#!/usr/bin/env python3
"""Thin wrapper around owncast_plugin.build for use without installing the
package (CI, `python3 sdks/python/owncast_plugin_build.py <dir> [--package]`).

Prefer the installed CLI for real authoring: `owncast-plugin-py build|package|
test|serve`. Plugins ship source and run on the host's embedded Python engine,
so no wasm toolchain (extism-py / binaryen) is involved either way.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from owncast_plugin.build import main  # noqa: E402

if __name__ == "__main__":
    main()
