"""Build an Owncast Python plugin to WebAssembly, and package it as a .ocpkg.

extism-py compiles a single .py file and can't import a separate SDK package
(local imports crash its freeze step), so this inlines the SDK runtime
(__init__.py), the author's code, and the host-function imports the manifest's
permissions grant into one module, then runs extism-py on it.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

# The runtime that gets inlined into every plugin: this package's __init__.py.
SDK_RUNTIME = os.path.join(os.path.dirname(os.path.abspath(__file__)), "__init__.py")

# Host functions grouped by the permission that grants them. The build only
# declares the ones the manifest asks for (plus the ambient group) — declaring
# a host fn the host won't wire would fail wasm instantiation. Each entry:
# (wasm import name, python signature, [return annotation]). All host fns use
# i64 (not i32) so they match extism-py, which maps every Python `int` to i64.
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

_IMPORT_RE = re.compile(r"^\s*(from\s+owncast_plugin\s+import\b|import\s+owncast_plugin\b)")


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def find_entry(project):
    for rel in ("src/plugin.py", "plugin.py"):
        p = os.path.join(project, rel)
        if os.path.exists(p):
            return p
    sys.exit("no plugin entry found (looked for src/plugin.py, plugin.py)")


def host_import_block(permissions):
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


def strip_sdk_import(src):
    return "\n".join("" if _IMPORT_RE.match(ln) else ln for ln in src.splitlines())


EXPORTS = '''
MANIFEST_BASE = %s


@extism.plugin_fn
def register():
    m = dict(MANIFEST_BASE)
    m["subscriptions"] = _describe_subscriptions()
    extism.output_str(json.dumps(m))


@extism.plugin_fn
def on_event():
    _dispatch_event(extism.input_json())


@extism.plugin_fn
def on_filter():
    extism.output_json(_dispatch_filter(extism.input_json()))


@extism.plugin_fn
def on_http_request():
    extism.output_json(_dispatch_http(extism.input_json()))


@extism.plugin_fn
def on_tab_content():
    extism.output_str(_dispatch_tab_content(extism.input_json()))


@extism.plugin_fn
def on_page_content():
    extism.output_str(_dispatch_page_content(extism.input_json()))
'''


def _read_manifest(project):
    manifest_path = os.path.join(project, "plugin.manifest.json")
    if not os.path.exists(manifest_path):
        sys.exit("no plugin.manifest.json in %s" % project)
    manifest = json.load(open(manifest_path))
    slug = manifest.get("slug") or slugify(manifest.get("name", ""))
    if not slug:
        sys.exit("manifest needs a slug or name")
    return manifest, slug


def build(project, extism_py=None, env=None):
    """Compile project's plugin into <slug>.wasm. extism_py/env let a caller
    (the CLI) supply a managed toolchain; otherwise extism-py is resolved from
    PATH (or ~/.local/bin) and the ambient environment is used."""
    manifest, slug = _read_manifest(project)
    permissions = manifest.get("permissions", [])

    sdk_src = open(SDK_RUNTIME).read()
    author_src = strip_sdk_import(open(find_entry(project)).read())
    manifest_base = {
        "slug": slug,
        "version": manifest.get("version", "0.0.0"),
        "permissions": permissions,
    }

    combined = "\n\n".join([
        sdk_src,
        "# --- host imports (granted permissions + ambient) ---",
        host_import_block(permissions),
        "# --- author code ---",
        author_src,
        "# --- generated exports ---",
        EXPORTS % json.dumps(manifest_base),
    ])

    build_dir = os.path.join(project, ".owncast-build")
    os.makedirs(build_dir, exist_ok=True)
    entry = os.path.join(build_dir, "entry.py")
    with open(entry, "w") as f:
        f.write(combined)

    extism_py = extism_py or shutil.which("extism-py") or os.path.expanduser("~/.local/bin/extism-py")
    if not os.path.exists(extism_py):
        sys.exit("extism-py not found (install the extism Python PDK, or use the owncast-plugin-py CLI which fetches it)")
    out = os.path.join(project, slug + ".wasm")
    proc = subprocess.run([extism_py, entry, "-o", out], capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout + proc.stderr)
        sys.exit("extism-py failed")
    print("built %s.wasm" % slug)
    return slug


def package(project, extism_py=None, env=None):
    """Build, then zip the manifest + wasm + public/ + assets/ (+ icon.png,
    INSTRUCTIONS.md) into <slug>.ocpkg — the single distributable file. Matches
    the JS SDK's `owncast-plugin package` layout exactly (the wasm is stored as
    plugin.wasm at the zip root), so the host loads Python and JS packages
    identically."""
    slug = build(project, extism_py=extism_py, env=env)
    wasm = os.path.join(project, slug + ".wasm")
    out = os.path.join(project, slug + ".ocpkg")
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.write(os.path.join(project, "plugin.manifest.json"), "plugin.manifest.json")
        z.write(wasm, "plugin.wasm")
        count += 2
        for name in ("icon.png", "INSTRUCTIONS.md"):
            p = os.path.join(project, name)
            if os.path.isfile(p):
                z.write(p, name)
                count += 1
        for sub in ("public", "assets"):
            base = os.path.join(project, sub)
            if not os.path.isdir(base):
                continue
            for root, _dirs, files in os.walk(base):
                for fn in sorted(files):
                    full = os.path.join(root, fn)
                    rel = os.path.relpath(full, base).replace(os.sep, "/")
                    z.write(full, "%s/%s" % (sub, rel))
                    count += 1
    os.remove(wasm)
    size_kb = round(os.path.getsize(out) / 1024)
    print("packaged %s.ocpkg (%d KB, %d files)" % (slug, size_kb, count))
    return slug


def main(argv=None):
    """Standalone entry (used by the owncast_plugin_build.py shim / CI)."""
    argv = sys.argv[1:] if argv is None else argv
    positional = [a for a in argv if not a.startswith("-")]
    proj = positional[0] if positional else "."
    if "--package" in argv:
        package(proj)
    else:
        build(proj)


if __name__ == "__main__":
    main()
