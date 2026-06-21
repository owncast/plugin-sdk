"""Lazily fetch and cache the host binaries the test/serve commands need.

Plugins ship source and run on the Python engine the host already embeds, so
there's no wasm compiler toolchain to fetch (extism-py / binaryen are a
maintainer-only dependency of the engine build, not the author flow). All this
module fetches are the host binaries:

  - host bins   owncast-plugin-test / owncast-plugin-serve, from this repo's
                GitHub releases (pin with OWNCAST_PLUGIN_HOST_BINARIES_VERSION,
                or point OWNCAST_PLUGIN_HOST_BIN_DIR at locally-built binaries)

They're cached under the user's cache dir (override with OWNCAST_PLUGIN_CACHE).
"""
import gzip
import json
import os
import platform
import shutil
import sys
import urllib.request

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


def _download(url, dest):
    sys.stderr.write("fetching %s\n" % url)
    try:
        with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
            shutil.copyfileobj(r, f)
    except Exception as e:  # noqa: BLE001
        sys.exit("download failed (%s): %s" % (url, e))


def _latest_host_tag():
    pinned = os.environ.get("OWNCAST_PLUGIN_HOST_BINARIES_VERSION")
    if pinned:
        return pinned if pinned.startswith("v") else "v" + pinned
    url = "https://api.github.com/repos/%s/releases/latest" % HOST_REPO
    try:
        with urllib.request.urlopen(url) as r:
            return json.load(r)["tag_name"]
    except Exception as e:  # noqa: BLE001
        sys.exit("could not resolve latest host-binary release (%s). Set "
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
