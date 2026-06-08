#!/usr/bin/env python3
"""Thin wrapper around owncast_plugin.build for use without installing the
package (CI, `python3 sdks/python/owncast_plugin_build.py <dir> [--package]`).

Prefer the installed CLI for real authoring: `owncast-plugin-py build|package|
test|serve` (it also fetches the wasm toolchain for you). This wrapper assumes
extism-py + binaryen are already on PATH.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from owncast_plugin.build import main  # noqa: E402

if __name__ == "__main__":
    main()
