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

# The runtime that gets inlined into the engine: this package's __init__.py.
SDK_RUNTIME = os.path.join(SDKDIR, "owncast_plugin", "__init__.py")

# Host functions grouped by the permission that grants them. The shared engine
# declares the FULL union (the host registers all of them and gates each by the
# calling plugin's permissions at call time). Each entry:
# (wasm import name, python signature, [return annotation]). All host fns use
# i64 (not i32) so they match extism-py, which maps every Python `int` to i64.
# Keep in sync with Owncast's BuildHostFunctions (services/plugins/hostfns.go)
# and the JS engine's host union (engines/javascript/engine.d.ts).
HOST_FNS = {
    "chat.send": [
        ("owncast_send_chat", "text: str"),
        ("owncast_send_chat_action", "text: str"),
        ("owncast_send_chat_system", "body: str"),
        ("owncast_send_chat_to", "client_id: int, text: str"),
    ],
    "chat.history": [
        ("owncast_chat_history", "limit: int", "str"),
        ("owncast_chat_clients", "", "str"),
    ],
    "chat.moderate": [
        ("owncast_delete_message", "message_id: str"),
        ("owncast_kick_client", "client_id: int"),
    ],
    "storage.kv": [
        ("owncast_kv_get", "key: str", "str"),
        ("owncast_kv_set", "key: str, value: str"),
    ],
    "storage.upload": [
        ("owncast_storage_upload", "name: str, data: str", "str"),
    ],
    "storage.fs": [
        ("owncast_fs_read", "path: str", "str"),
        ("owncast_fs_write", "path: str, data: str", "str"),
        ("owncast_fs_list", "directory: str", "str"),
        ("owncast_fs_delete", "path: str", "str"),
        ("owncast_fs_exists", "path: str", "int"),
    ],
    "events.emit": [
        ("owncast_emit_event", "event_type: str, payload: str"),
    ],
    "server.read": [
        ("owncast_stream_current", "", "str"),
        ("owncast_stream_broadcaster", "", "str"),
        ("owncast_server_info", "", "str"),
        ("owncast_server_socials", "", "str"),
        ("owncast_server_emotes", "", "str"),
        ("owncast_server_federation", "", "str"),
        ("owncast_server_tags", "", "str"),
    ],
    "videoconfig.read": [
        ("owncast_video_config_read", "", "str"),
    ],
    "videoconfig.write": [
        ("owncast_video_config_write", "config: str", "str"),
    ],
    "notifications.send": [
        ("owncast_notify_discord", "text: str"),
        ("owncast_notify_browser_push", "payload: str"),
        ("owncast_notify_fediverse", "payload: str"),
    ],
    "users.read": [
        ("owncast_users_list", "", "str"),
        ("owncast_user_get", "user_id: str", "str"),
    ],
    "users.moderate": [
        ("owncast_user_set_enabled", "user_id: str, enabled: int, reason: str"),
        ("owncast_ban_ip", "ip: str"),
    ],
    "users.register": [
        ("owncast_users_register", "request: str", "str"),
    ],
    "auth.gate": [
        ("owncast_auth_grant_session", "request: str", "str"),
        ("owncast_auth_end_session", ""),
    ],
    "fediverse.post": [
        ("owncast_fediverse_post", "text: str", "str"),
    ],
    "http.sse": [
        ("owncast_sse_send", "channel: str, event: str, data: str"),
    ],
    "ui.modify": [
        ("owncast_add_actions", "payload: str"),
        ("owncast_clear_actions", ""),
    ],
}

# Granted to every plugin without a declared permission (see WIRE_PROTOCOL.md).
AMBIENT_FNS = [
    ("owncast_timer_set", "timer_id: int, delay_ms: int, repeat: int", "int"),
    ("owncast_timer_clear", "timer_id: int"),
    ("owncast_config_get", "key: str", "str"),
    ("owncast_asset_read", "path: str", "str"),
]


def host_import_block(permissions):
    """Emit the @extism.import_fn declarations for the ambient host functions
    plus those granted by `permissions`, registering each into the SDK
    runtime's `_HOST` dispatch table."""
    specs = list(AMBIENT_FNS)
    for perm in permissions:
        specs.extend(HOST_FNS.get(perm, []))
    lines = []
    for spec in specs:
        name, sig = spec[0], spec[1]
        ret = (" -> " + spec[2]) if len(spec) > 2 else ""
        lines.append('@extism.import_fn("extism:host/user", "%s")' % name)
        lines.append("def _imp_%s(%s)%s: ..." % (name, sig, ret))
        lines.append('_HOST["%s"] = _imp_%s' % (name, name))
    return "\n".join(lines)


CACHE = os.path.expanduser("~/.cache/owncast-plugin-sdk")
EXTISM_PY = os.environ.get("EXTISM_PY") or os.path.join(CACHE, "bin/extism-py")
ENV = dict(
    os.environ,
    LD_LIBRARY_PATH=os.path.join(CACHE, "data"),
    PATH=os.path.join(CACHE, "bin") + ":" + os.environ.get("PATH", ""),
)

# Full permission union so the engine declares every host function. The host
# registers all of them and gates each by the calling plugin's permissions.
ALL_PERMS = list(HOST_FNS.keys())

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
def on_auth_check():
    _ensure_loaded()
    extism.output_json(_dispatch_auth_check(extism.input_json()))


@extism.plugin_fn
def on_tab_content():
    _ensure_loaded()
    extism.output_str(_dispatch_tab_content(extism.input_json()))


@extism.plugin_fn
def on_page_content():
    _ensure_loaded()
    extism.output_str(_dispatch_page_content(extism.input_json()))


@extism.plugin_fn
def on_page_styles():
    _ensure_loaded()
    extism.output_str(_dispatch_page_styles())


@extism.plugin_fn
def on_page_scripts():
    _ensure_loaded()
    extism.output_str(_dispatch_page_scripts())
'''


def main():
    out_dir = (
        (sys.argv[1] if len(sys.argv) > 1 else None)
        or os.environ.get("OWNCAST_ENGINE_DIR")
        or os.path.abspath(os.path.join(REPO, "../owncast/services/plugins/engines/python"))
    )
    sdk_src = open(SDK_RUNTIME).read()
    combined = "\n\n".join([
        sdk_src,
        "# --- host imports (full union) ---",
        host_import_block(ALL_PERMS),
        BOOTSTRAP,
        "# --- generated exports ---",
        EXPORTS,
    ])
    build_dir = os.path.join(HERE, ".build")
    os.makedirs(build_dir, exist_ok=True)
    entry = os.path.join(build_dir, "engine-entry.py")
    open(entry, "w").write(combined)

    if not os.path.exists(EXTISM_PY):
        sys.exit("extism-py not found at %s. Run a Python build once to fetch the toolchain." % EXTISM_PY)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "engine.wasm")
    proc = subprocess.run([EXTISM_PY, entry, "-o", out], capture_output=True, text=True, env=ENV)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout + proc.stderr)
        sys.exit("extism-py failed")
    print("built Python engine: %s (%d bytes)" % (out, os.path.getsize(out)))


if __name__ == "__main__":
    main()
