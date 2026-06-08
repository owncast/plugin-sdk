"""Lazily fetch and cache the wasm toolchain the build/test/serve commands need.

Python wheels can't run install hooks the way npm's postinstall does, so the
CLI downloads its toolchain on first use and caches it under the user's cache
dir (override with OWNCAST_PLUGIN_CACHE):

  - extism-py   the Python -> wasm compiler (+ its CPython engine "share" tree)
  - binaryen    wasm-merge / wasm-opt, which extism-py shells out to
  - host bins   owncast-plugin-test / owncast-plugin-serve, from this repo's
                GitHub releases (pin with OWNCAST_PLUGIN_HOST_BINARIES_VERSION,
                or point OWNCAST_PLUGIN_HOST_BIN_DIR at locally-built binaries)

extism-py honors XDG_DATA_HOME for its engine, so everything stays inside the
cache — nothing is written to ~/.local.
"""
import gzip
import json
import os
import platform
import shutil
import sys
import tarfile
import urllib.request

EXTISM_PY_VERSION = "v0.1.5"
BINARYEN_VERSION = "version_119"
HOST_REPO = "owncast/plugin-sdk"


def _os():
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "darwin":
        return "macos"
    sys.exit("unsupported OS: %s" % sys.platform)


def _arch():
    m = platform.machine().lower()
    if m in ("x86_64", "amd64"):
        return "x86_64"
    if m in ("aarch64", "arm64"):
        return "aarch64"
    sys.exit("unsupported arch: %s" % m)


def cache_dir():
    base = os.environ.get("OWNCAST_PLUGIN_CACHE") or os.environ.get("XDG_CACHE_HOME") \
        or os.path.join(os.path.expanduser("~"), ".cache")
    d = os.path.join(base, "owncast-plugin-sdk")
    os.makedirs(d, exist_ok=True)
    return d


def _bin_dir():
    d = os.path.join(cache_dir(), "bin")
    os.makedirs(d, exist_ok=True)
    return d


def _download(url, dest):
    sys.stderr.write("fetching %s\n" % url)
    try:
        with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
    except Exception as e:  # noqa: BLE001
        sys.exit("download failed (%s): %s" % (url, e))


def ensure_extism_py():
    """Return the path to extism-py, downloading + caching it (and its engine
    share tree, under <cache>/data/extism-py for XDG_DATA_HOME) if needed."""
    dest = os.path.join(_bin_dir(), "extism-py")
    share = os.path.join(cache_dir(), "data", "extism-py")
    if os.path.exists(dest) and os.path.isdir(share):
        return dest
    arch = _arch()
    url = ("https://github.com/extism/python-pdk/releases/download/%s/"
           "extism-py-%s-%s-%s.tar.gz" % (EXTISM_PY_VERSION, arch, _os(), EXTISM_PY_VERSION))
    tgz = os.path.join(cache_dir(), "extism-py.tar.gz")
    _download(url, tgz)
    tmp = os.path.join(cache_dir(), "_extism-py-extract")
    shutil.rmtree(tmp, ignore_errors=True)
    with tarfile.open(tgz) as t:
        t.extractall(tmp)
    shutil.copy(os.path.join(tmp, "extism-py", "bin", "extism-py"), dest)
    os.chmod(dest, 0o755)
    os.makedirs(os.path.dirname(share), exist_ok=True)
    shutil.rmtree(share, ignore_errors=True)
    shutil.copytree(os.path.join(tmp, "extism-py", "share", "extism-py"), share)
    shutil.rmtree(tmp, ignore_errors=True)
    os.remove(tgz)
    return dest


def ensure_binaryen():
    """Ensure wasm-merge / wasm-opt (+ libbinaryen) are in the cache."""
    if os.path.exists(os.path.join(_bin_dir(), "wasm-opt")):
        return
    # binaryen names arm64 (not aarch64); it ships no linux-arm64 build, so fall
    # back to x86_64 there (matches the official extism-py installer).
    arch = "arm64" if _arch() == "aarch64" else "x86_64"
    if arch == "arm64" and _os() == "linux":
        arch = "x86_64"
    url = ("https://github.com/WebAssembly/binaryen/releases/download/%s/"
           "binaryen-%s-%s-%s.tar.gz" % (BINARYEN_VERSION, BINARYEN_VERSION, arch, _os()))
    tgz = os.path.join(cache_dir(), "binaryen.tar.gz")
    _download(url, tgz)
    tmp = os.path.join(cache_dir(), "_binaryen-extract")
    shutil.rmtree(tmp, ignore_errors=True)
    with tarfile.open(tgz) as t:
        t.extractall(tmp)
    root = os.path.join(tmp, "binaryen-%s" % BINARYEN_VERSION)
    for tool in ("wasm-merge", "wasm-opt"):
        shutil.copy(os.path.join(root, "bin", tool), os.path.join(_bin_dir(), tool))
        os.chmod(os.path.join(_bin_dir(), tool), 0o755)
    libdst = os.path.join(cache_dir(), "lib")
    shutil.rmtree(libdst, ignore_errors=True)
    shutil.copytree(os.path.join(root, "lib"), libdst)
    shutil.rmtree(tmp, ignore_errors=True)
    os.remove(tgz)


def _latest_host_tag():
    pinned = os.environ.get("OWNCAST_PLUGIN_HOST_BINARIES_VERSION")
    if pinned:
        return pinned if pinned.startswith("v") else "v" + pinned
    url = "https://api.github.com/repos/%s/releases/latest" % HOST_REPO
    try:
        with urllib.request.urlopen(url) as r:
            return json.load(r)["tag_name"]
    except Exception as e:  # noqa: BLE001
        sys.exit("could not resolve latest host-binary release (%s); set "
                 "OWNCAST_PLUGIN_HOST_BINARIES_VERSION or OWNCAST_PLUGIN_HOST_BIN_DIR" % e)


def ensure_host_binary(name):
    """Return a path to owncast-plugin-test / owncast-plugin-serve. Prefers a
    locally-built binary (OWNCAST_PLUGIN_HOST_BIN_DIR or one already on PATH),
    else downloads the release asset and caches it."""
    override = os.environ.get("OWNCAST_PLUGIN_HOST_BIN_DIR")
    if override:
        p = os.path.join(override, name)
        if os.path.exists(p):
            return p
    on_path = shutil.which(name)
    if on_path:
        return on_path
    tag = _latest_host_tag()
    dest_dir = os.path.join(cache_dir(), "host", tag)
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, name)
    if os.path.exists(dest):
        return dest
    goos = "darwin" if _os() == "macos" else "linux"
    goarch = "arm64" if _arch() == "aarch64" else "amd64"
    url = ("https://github.com/%s/releases/download/%s/%s-%s-%s.gz"
           % (HOST_REPO, tag, name, goos, goarch))
    gz = dest + ".gz"
    _download(url, gz)
    with gzip.open(gz, "rb") as src, open(dest, "wb") as out:
        shutil.copyfileobj(src, out)
    os.chmod(dest, 0o755)
    os.remove(gz)
    return dest


def build_env():
    """Environment for invoking extism-py: cache bin on PATH, libbinaryen on
    the loader path, and the extism-py engine via XDG_DATA_HOME."""
    env = dict(os.environ)
    env["PATH"] = _bin_dir() + os.pathsep + env.get("PATH", "")
    lib = os.path.join(cache_dir(), "lib")
    for var in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH"):
        env[var] = lib + os.pathsep + env.get(var, "")
    env["XDG_DATA_HOME"] = os.path.join(cache_dir(), "data")
    return env
