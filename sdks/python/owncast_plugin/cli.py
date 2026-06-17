"""`owncast-plugin-py` — build, package, test, and serve Owncast Python plugins.

Plugins ship their source and run on the Python engine the host already embeds
(the shared-engine model), so an author never compiles to wasm: `build` just
emits the plugin source as <slug>.py. No PDK (extism-py / binaryen) is needed —
only `pip install owncast-plugin-sdk` (or `uv add` / `uvx owncast-plugin-py ...`)
and this command. The host binaries that back `test`/`serve` are fetched and
cached on first use by toolchain.py.
"""
import argparse
import os
import subprocess
import sys

from . import build as _build
from . import scaffold as _scaffold
from . import toolchain


def _emit(project, do_package):
    fn = _build.package if do_package else _build.build
    return fn(project)


def cmd_build(args):
    _emit(args.dir, do_package=False)


def cmd_package(args):
    _emit(args.dir, do_package=True)


def cmd_test(args):
    _emit(args.dir, do_package=False)
    test_bin = toolchain.ensure_host_binary("owncast-plugin-test")
    sys.exit(subprocess.run([test_bin, args.dir]).returncode)


def cmd_serve(args):
    _emit(args.dir, do_package=False)
    serve_bin = toolchain.ensure_host_binary("owncast-plugin-serve")
    env = dict(os.environ)
    if args.port:
        env["PORT"] = str(args.port)
    sys.exit(subprocess.run([serve_bin, args.dir], env=env).returncode)


def cmd_new(args):
    _scaffold.create(args.slug)


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="owncast-plugin-py",
        description="Build, package, test, and serve Owncast Python plugins.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def add(name, help_text):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("dir", nargs="?", default=".", help="plugin project dir (default: .)")
        return p

    new_p = sub.add_parser("new", help="scaffold a new plugin project in ./<slug>")
    new_p.add_argument("slug", help="plugin slug / target directory (e.g. my-cool-bot)")
    new_p.set_defaults(func=cmd_new)

    add("build", "emit src/plugin.py as <slug>.py").set_defaults(func=cmd_build)
    add("package", "build + bundle into <slug>.ocpkg").set_defaults(func=cmd_package)
    add("test", "build, then run the __tests__ scenarios").set_defaults(func=cmd_test)
    serve_p = add("serve", "build, then run a local dev server")
    serve_p.add_argument("-p", "--port", type=int, help="port (default 8080)")
    serve_p.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
