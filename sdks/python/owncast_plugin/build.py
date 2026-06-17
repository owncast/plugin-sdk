"""Emit an Owncast Python plugin as <slug>.py, and package it as a .ocpkg.

Shared-engine model: plugins ship their source and run on the Python engine the
host already embeds, so there's no wasm compile step and no PDK (extism-py /
binaryen). `build` just writes the author's plugin source as <slug>.py with the
`from owncast_plugin import ...` line stripped (the SDK names are globals in the
embedded engine); the host infers the Python runtime from the plugin.py filename.
"""
import json
import os
import re
import sys
import zipfile


_IMPORT_RE = re.compile(r"^\s*(from\s+owncast_plugin\s+import\b|import\s+owncast_plugin\b)")


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def find_entry(project):
    for rel in ("src/plugin.py", "plugin.py"):
        p = os.path.join(project, rel)
        if os.path.exists(p):
            return p
    sys.exit("no plugin entry found (looked for src/plugin.py, plugin.py)")


def strip_sdk_import(src):
    return "\n".join("" if _IMPORT_RE.match(ln) else ln for ln in src.splitlines())


def _read_manifest(project):
    manifest_path = os.path.join(project, "plugin.manifest.json")
    if not os.path.exists(manifest_path):
        sys.exit("no plugin.manifest.json in %s" % project)
    manifest = json.load(open(manifest_path))
    slug = manifest.get("slug") or slugify(manifest.get("name", ""))
    if not slug:
        sys.exit("manifest needs a slug or name")
    return manifest, slug


def build(project):
    """Emit the author's plugin as <slug>.py (the plugin source with the
    `from owncast_plugin import ...` line stripped — the SDK names are globals in
    the embedded engine). The host infers the Python runtime from the plugin.py
    filename and runs it on the embedded Python engine."""
    _manifest, slug = _read_manifest(project)
    author_src = strip_sdk_import(open(find_entry(project)).read())
    out = os.path.join(project, slug + ".py")
    with open(out, "w") as f:
        f.write(author_src)
    print("built %s.py" % slug)
    return slug


def package(project):
    """Build, then zip the manifest + plugin.py + public/ + assets/ (+ icon.png,
    INSTRUCTIONS.md) into <slug>.ocpkg — the single distributable file. The code
    entry's name (plugin.py) is what tells the host this is a Python plugin, so
    no "type" field is needed in the manifest; it ships verbatim. Matches the JS
    SDK's `owncast-plugin package` layout so the host loads both identically."""
    slug = build(project)
    script = os.path.join(project, slug + ".py")
    out = os.path.join(project, slug + ".ocpkg")

    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.write(os.path.join(project, "plugin.manifest.json"), "plugin.manifest.json")
        z.write(script, "plugin.py")
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
    os.remove(script)
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
