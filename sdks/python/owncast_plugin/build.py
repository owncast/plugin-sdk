"""Emit an Owncast Python plugin as <slug>.py, and package it as a .ocpkg.

Shared-engine model: plugins ship their source and run on the Python engine the
host already embeds, so there's no wasm compile step and no PDK (extism-js /
binaryen). The host execs the single shipped `plugin.py` and infers the Python
runtime from that filename.

A single-file plugin is emitted verbatim with the `from owncast_plugin import ...`
line stripped (the SDK names are globals in the embedded engine). A multi-file
plugin (one whose entry imports other `.py` files in its source directory) is
*bundled*: the entry's local import graph is inlined into one `plugin.py` that
carries each module's source in memory, the same way the JS SDK's esbuild step
bundles local `require`s. This needs no engine change.

The embedded CPython can't read new files at plugin-exec time (no filesystem, and
its stdlib zip is only readable during engine init, so a fresh `import importlib.util`
fails with a bad file descriptor). So the bundle can't install an import hook. It
instead pre-populates `sys.modules` directly, using only `sys` and `types` (both
already cached): it creates a module object per bundled file, links each into its
parent package, then `exec`s their sources in dependency order so every
`from x import y` resolves from `sys.modules` without touching the import system.
"""
import ast
import json
import os
import re
import sys
import zipfile


_IMPORT_RE = re.compile(r"^\s*(from\s+owncast_plugin\s+import\b|import\s+owncast_plugin\b)")

# Public SDK names the engine injects as globals. The bundle re-exposes these
# through a synthetic in-memory `owncast_plugin` module so bundled author files
# can `from owncast_plugin import ...` like normal Python.
_SDK_EXPORTS = ("plugin", "owncast", "filter", "define_commands", "CommandContext", "ChatMessage")

# Top-level module names that must never be treated as local (and thus shadowed),
# even if a same-named file sits next to the plugin. Mirrors the engine's stdlib.
_STDLIB = set(getattr(sys, "stdlib_module_names", ())) | set(sys.builtin_module_names) | {
    "json", "re", "os", "sys", "math", "random", "time", "datetime", "base64",
    "hashlib", "itertools", "collections", "functools", "typing", "dataclasses",
    "decimal", "fractions", "string", "textwrap", "enum", "abc", "copy", "io",
}


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


# --- multi-file bundling ---------------------------------------------------

def _module_file(src_dir, dotted):
    """Map a dotted module name to a file under src_dir. Returns (path, is_package)
    or None when the name isn't a local module (stdlib / third-party / a `from`ed
    attribute rather than a submodule)."""
    parts = dotted.split(".")
    base = os.path.join(src_dir, *parts)
    pkg_init = os.path.join(base, "__init__.py")
    if os.path.isfile(pkg_init):
        return pkg_init, True
    mod_file = base + ".py"
    if os.path.isfile(mod_file):
        return mod_file, False
    return None


def _resolve_relative(importer, importer_is_pkg, level, module):
    """Resolve a relative import (`from . import x`) to an absolute dotted name,
    given the importing module's own dotted name. Returns None if it climbs past
    the source root."""
    base = importer if importer_is_pkg else importer.rpartition(".")[0]
    bits = base.split(".") if base else []
    up = level - 1
    if up > len(bits):
        return None
    if up:
        bits = bits[: len(bits) - up]
    target = ".".join(bits)
    if module:
        target = target + "." + module if target else module
    return target or None


def _collect_modules(entry_src, src_dir):
    """Walk the entry's local import graph. Returns (modules, deps) where modules
    is {dotted_name: (source, is_package)} for every module that resolves to a file
    under src_dir (parent packages included), and deps is {name: set(names it
    imports)} for ordering. Stdlib, third-party, and `owncast_plugin` imports are
    left alone (the engine resolves them at runtime). Exits with a clear message on
    an entry-level relative import, which can't work without a package."""
    modules = {}
    deps = {}

    def ensure(dotted):
        """Resolve a dotted name (and its parent packages) to bundled modules.
        Returns the list of bundled names this reference introduces, so the caller
        can record dependency edges. Returns [] for non-local names."""
        if not dotted or dotted.split(".")[0] in _STDLIB or dotted == "owncast_plugin":
            return []
        if not _module_file(src_dir, dotted):
            return []
        names = []
        parts = dotted.split(".")
        for i in range(1, len(parts) + 1):
            name = ".".join(parts[:i])
            found = _module_file(src_dir, name)
            if not found:
                # a parent path component isn't a package: stop, not bundlable
                break
            if name not in modules:
                with open(found[0]) as fh:
                    modules[name] = (fh.read(), found[1])
                deps[name] = set()
                _scan(modules[name][0], name, found[1])
            names.append(name)
        return names

    def _scan(src, importer, importer_is_pkg):
        try:
            tree = ast.parse(src)
        except SyntaxError as e:
            sys.exit("syntax error in %s: %s" % (importer or "plugin entry", e))
        for node in ast.walk(tree):
            targets = []
            if isinstance(node, ast.Import):
                targets = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    if not importer:
                        sys.exit(
                            "relative import in plugin entry is not supported. "
                            "Use an absolute import like `from helpers import ...`"
                        )
                    base = _resolve_relative(importer, importer_is_pkg, node.level, node.module)
                    if base:
                        targets = [base] + [base + "." + a.name for a in node.names]
                elif node.module:
                    targets = [node.module] + [node.module + "." + a.name for a in node.names]
            for t in targets:
                for name in ensure(t):
                    if importer:
                        deps[importer].add(name)

    _scan(entry_src, "", False)
    return modules, deps


def _order_modules(modules, deps):
    """Dependency-first order (each module after the modules it imports), so that
    exec'ing in this order leaves every `from x import y` resolvable. Tolerates
    import cycles by breaking them arbitrarily (they'd fail at runtime under plain
    CPython too)."""
    order = []
    done = set()
    active = set()

    def visit(name):
        if name in done or name in active:
            return
        active.add(name)
        for dep in sorted(deps.get(name, ())):
            if dep in modules:
                visit(dep)
        active.discard(name)
        done.add(name)
        order.append(name)

    for name in sorted(modules):
        visit(name)
    return order


_BUNDLE_RUNTIME = '''
for _ocp_name, _ocp_is_pkg, _ocp_src in _OCP_MODULES:
    _ocp_m = _ocp_types.ModuleType(_ocp_name)
    _ocp_m.__file__ = "<ocp:" + _ocp_name + ">"
    if _ocp_is_pkg:
        _ocp_m.__path__ = []
        _ocp_m.__package__ = _ocp_name
    else:
        _ocp_m.__package__ = _ocp_name.rpartition(".")[0]
    _ocp_sys.modules[_ocp_name] = _ocp_m

for _ocp_name, _ocp_is_pkg, _ocp_src in _OCP_MODULES:
    _ocp_parent, _ocp_dot, _ocp_leaf = _ocp_name.rpartition(".")
    if _ocp_parent:
        setattr(_ocp_sys.modules[_ocp_parent], _ocp_leaf, _ocp_sys.modules[_ocp_name])

for _ocp_name, _ocp_is_pkg, _ocp_src in _OCP_MODULES:
    _ocp_m = _ocp_sys.modules[_ocp_name]
    exec(compile(_ocp_src, _ocp_m.__file__, "exec"), _ocp_m.__dict__)
'''


def _render_bundle(entry_src, modules, order):
    out = [
        "# --- bundled by owncast-plugin-py: multi-file plugin, do not edit ---",
        "import sys as _ocp_sys, types as _ocp_types",
        "",
        "if 'owncast_plugin' not in _ocp_sys.modules:",
        "    _ocp_sdk = _ocp_types.ModuleType('owncast_plugin')",
        "    for _ocp_n in %r:" % (_SDK_EXPORTS,),
        "        if _ocp_n in globals():",
        "            setattr(_ocp_sdk, _ocp_n, globals()[_ocp_n])",
        "    _ocp_sys.modules['owncast_plugin'] = _ocp_sdk",
        "",
        "_OCP_MODULES = [",
    ]
    for name in order:
        src, is_pkg = modules[name]
        out.append("    (%r, %r, %r)," % (name, is_pkg, src))
    out.append("]")
    out.append(_BUNDLE_RUNTIME)
    out.append("# --- plugin entry ---")
    out.append(entry_src)
    return "\n".join(out)


def build(project):
    """Emit the author's plugin as <slug>.py. A single-file plugin is emitted with
    the SDK import line stripped. A plugin that imports local modules is bundled
    into one self-contained <slug>.py. Either way the host runs the result on the
    embedded Python engine."""
    _manifest, slug = _read_manifest(project)
    entry = find_entry(project)
    with open(entry) as f:
        entry_src = f.read()
    modules, deps = _collect_modules(entry_src, os.path.dirname(entry))
    if modules:
        out_src = _render_bundle(entry_src, modules, _order_modules(modules, deps))
    else:
        out_src = strip_sdk_import(entry_src)
    out = os.path.join(project, slug + ".py")
    with open(out, "w") as f:
        f.write(out_src)
    if modules:
        n = len(modules)
        print("built %s.py (bundled %d local module%s)" % (slug, n, "" if n == 1 else "s"))
    else:
        print("built %s.py" % slug)
    return slug


def package(project):
    """Build, then zip the manifest + plugin.py + public/ + assets/ (+ icon.png,
    INSTRUCTIONS.md) into <slug>.ocpkg, the single distributable file. The code
    entry's name (plugin.py) is what tells the host this is a Python plugin, so
    no "type" field is needed in the manifest, and it ships verbatim. Matches the JS
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
