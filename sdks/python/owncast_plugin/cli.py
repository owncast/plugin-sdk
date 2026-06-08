"""`owncast-plugin-py` — build, package, test, and serve Owncast Python plugins.

Wraps the inlining build (build.py) with a managed toolchain (toolchain.py):
the wasm compiler and host binaries are fetched and cached on first use, so a
plugin author only needs `pip install owncast-plugin-sdk` (or `uv add` /
`uvx owncast-plugin-py ...`) and this command.
"""
import argparse
import os
import subprocess
import sys

from . import build as _build
from . import toolchain


def _compile(project, do_package):
    extism_py = toolchain.ensure_extism_py()
    toolchain.ensure_binaryen()
    env = toolchain.build_env()
    fn = _build.package if do_package else _build.build
    return fn(project, extism_py=extism_py, env=env)


def cmd_build(args):
    _compile(args.dir, do_package=False)


def cmd_package(args):
    _compile(args.dir, do_package=True)


def cmd_test(args):
    _compile(args.dir, do_package=False)
    test_bin = toolchain.ensure_host_binary("owncast-plugin-test")
    sys.exit(subprocess.run([test_bin, args.dir]).returncode)


def cmd_serve(args):
    _compile(args.dir, do_package=False)
    serve_bin = toolchain.ensure_host_binary("owncast-plugin-serve")
    env = dict(os.environ)
    if args.port:
        env["PORT"] = str(args.port)
    sys.exit(subprocess.run([serve_bin, args.dir], env=env).returncode)


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

    add("build", "compile src/plugin.py to <slug>.wasm").set_defaults(func=cmd_build)
    add("package", "build + bundle into <slug>.ocpkg").set_defaults(func=cmd_package)
    add("test", "build, then run the __tests__ scenarios").set_defaults(func=cmd_test)
    serve_p = add("serve", "build, then run a local dev server")
    serve_p.add_argument("-p", "--port", type=int, help="port (default 8080)")
    serve_p.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
