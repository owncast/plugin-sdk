"""Build the shared Python engine (engine.wasm) and copy it into Owncast's
embed directory. Run via `make engines` (or: `python3 engines/build_py.py [outDir]`).

The engine inlines the SDK runtime (owncast_plugin/__init__.py) + the FULL host
import union + common stdlib pre-imports + a bootstrap that reads the author
script from Extism config at runtime and exec()s it into the engine's globals.
Because this entry is fixed, engine.wasm is byte-identical for every Python
plugin, so the host compiles CPython once and shares it across all plugins.

NOTE: exec()'d author scripts cannot import stdlib modules the engine did not
freeze at build time (no filesystem in the sandbox), so the engine pre-imports a
generous common set. Extend PRE_IMPORTS if plugins need more.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SDKDIR = os.path.join(REPO, "sdks/python")
sys.path.insert(0, SDKDIR)
from owncast_plugin import build as B  # reuse host_import_block, SDK_RUNTIME, HOST_FNS

CACHE = os.path.expanduser("~/.cache/owncast-plugin-sdk")
EXTISM_PY = os.environ.get("EXTISM_PY") or os.path.join(CACHE, "bin/extism-py")
ENV = dict(
    os.environ,
    LD_LIBRARY_PATH=os.path.join(CACHE, "data"),
    PATH=os.path.join(CACHE, "bin") + ":" + os.environ.get("PATH", ""),
)

# Full permission union so the engine declares every host function; the host
# registers all of them and gates each by the calling plugin's permissions.
ALL_PERMS = list(B.HOST_FNS.keys())

PRE_IMPORTS = "import datetime, re, math, random, time, base64, hashlib, itertools, collections, functools"

BOOTSTRAP = '''
# Pre-import common stdlib so extism-py freezes them INTO the shared engine.
# Author scripts are exec()d at runtime and cannot pull in modules not frozen at
# build time (no filesystem in the sandbox).
%s

# Shared-engine bootstrap: load the author script from Extism config at runtime.
_loaded = False

def _ensure_loaded():
    global _loaded
    if _loaded:
        return
    src = extism.Config.get_str("script")
    if not src:
        return  # build-time pre-init: no config yet, defer.
    exec(src, globals())
    _loaded = True
''' % PRE_IMPORTS

# EXPORTS mirror sdks/python build.py, but call _ensure_loaded() first and read
# the manifest from config instead of a baked-in MANIFEST_BASE.
EXPORTS = '''
@extism.plugin_fn
def register():
    _ensure_loaded()
    import json as _json
    m = _json.loads(extism.Config.get_str("manifest") or "{}")
    m["subscriptions"] = _describe_subscriptions()
    m["commands"] = _describe_commands()
    extism.output_str(_json.dumps(m))


@extism.plugin_fn
def on_event():
    _ensure_loaded()
    _dispatch_event(extism.input_json())


@extism.plugin_fn
def on_filter():
    _ensure_loaded()
    extism.output_json(_dispatch_filter(extism.input_json()))


@extism.plugin_fn
def on_http_request():
    _ensure_loaded()
    extism.output_json(_dispatch_http(extism.input_json()))


@extism.plugin_fn
def on_tab_content():
    _ensure_loaded()
    extism.output_str(_dispatch_tab_content(extism.input_json()))


@extism.plugin_fn
def on_page_content():
    _ensure_loaded()
    extism.output_str(_dispatch_page_content(extism.input_json()))
'''


def main():
    out_dir = (
        (sys.argv[1] if len(sys.argv) > 1 else None)
        or os.environ.get("OWNCAST_ENGINE_DIR")
        or os.path.abspath(os.path.join(REPO, "../owncast/services/plugins/engines/python"))
    )
    sdk_src = open(B.SDK_RUNTIME).read()
    combined = "\n\n".join([
        sdk_src,
        "# --- host imports (full union) ---",
        B.host_import_block(ALL_PERMS),
        BOOTSTRAP,
        "# --- generated exports ---",
        EXPORTS,
    ])
    build_dir = os.path.join(HERE, ".build")
    os.makedirs(build_dir, exist_ok=True)
    entry = os.path.join(build_dir, "engine-entry.py")
    open(entry, "w").write(combined)

    if not os.path.exists(EXTISM_PY):
        sys.exit("extism-py not found at %s — run a Python build once to fetch the toolchain" % EXTISM_PY)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "engine.wasm")
    proc = subprocess.run([EXTISM_PY, entry, "-o", out], capture_output=True, text=True, env=ENV)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout + proc.stderr)
        sys.exit("extism-py failed")
    print("built Python engine: %s (%d bytes)" % (out, os.path.getsize(out)))


if __name__ == "__main__":
    main()
