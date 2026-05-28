#!/usr/bin/env node
// Downloads per-platform tooling into <sdk>/bin/.cache so the build CLI
// finds it without polluting the user's system:
//
//   - extism-js                  — JS → wasm compiler (extism/js-pdk releases)
//   - wasm-merge, wasm-opt, lib  — binaryen post-processing (WebAssembly/binaryen releases)
//   - owncast-plugin-test/serve  — scenario runner + dev server (this repo's releases)
//
// PoC scope: linux-x86_64 + darwin-arm64 + darwin-x86_64 covered.
// owncast-plugin-test/serve downloads gracefully skip if the matching
// release asset isn't published yet — dev builds can substitute their own
// via tools/bootstrap.sh.

const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const EXTISM_JS_VERSION = "v1.6.0";
const BINARYEN_VERSION = "version_119";
// Tracks the SDK version that the host binaries were cut for. Usually
// matches the SDK's own version in package.json.
const HOST_BINARIES_VERSION = require("../package.json").version;
const HOST_BINARIES_REPO = "owncast/plugin-sdk";

const platform = process.platform;
const arch = process.arch;

function platformKey() {
  if (platform === "linux" && arch === "x64") return "linux-x86_64";
  if (platform === "linux" && arch === "arm64") return "linux-aarch64";
  if (platform === "darwin" && arch === "x64") return "darwin-x86_64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  throw new Error(`unsupported platform: ${platform}/${arch}`);
}

function extismJsURL() {
  // extism-js release naming uses different conventions per OS.
  const map = {
    "linux-x86_64": `extism-js-x86_64-linux-${EXTISM_JS_VERSION}.gz`,
    "linux-aarch64": `extism-js-aarch64-linux-${EXTISM_JS_VERSION}.gz`,
    "darwin-x86_64": `extism-js-x86_64-macos-${EXTISM_JS_VERSION}.gz`,
    "darwin-arm64": `extism-js-aarch64-macos-${EXTISM_JS_VERSION}.gz`
  };
  const file = map[platformKey()];
  return `https://github.com/extism/js-pdk/releases/download/${EXTISM_JS_VERSION}/${file}`;
}

function binaryenURL() {
  const map = {
    "linux-x86_64": `binaryen-${BINARYEN_VERSION}-x86_64-linux.tar.gz`,
    "linux-aarch64": `binaryen-${BINARYEN_VERSION}-aarch64-linux.tar.gz`,
    "darwin-x86_64": `binaryen-${BINARYEN_VERSION}-x86_64-macos.tar.gz`,
    "darwin-arm64": `binaryen-${BINARYEN_VERSION}-arm64-macos.tar.gz`
  };
  const file = map[platformKey()];
  return `https://github.com/WebAssembly/binaryen/releases/download/${BINARYEN_VERSION}/${file}`;
}

function hostBinaryURL(name) {
  // Per-platform asset naming matches Go's GOOS-GOARCH convention so the
  // release CI can `go build` once per matrix entry without renaming.
  const map = {
    "linux-x86_64": "linux-amd64",
    "linux-aarch64": "linux-arm64",
    "darwin-x86_64": "darwin-amd64",
    "darwin-arm64": "darwin-arm64"
  };
  const suffix = map[platformKey()];
  return `https://github.com/${HOST_BINARIES_REPO}/releases/download/v${HOST_BINARIES_VERSION}/${name}-${suffix}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = (u) =>
      https.get(u, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) return req(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", reject);
      });
    req(url);
  });
}

async function main() {
  const cacheDir = path.join(__dirname, "..", "bin", ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const extismDest = path.join(cacheDir, "extism-js");
  if (!fs.existsSync(extismDest)) {
    const gz = path.join(cacheDir, "extism-js.gz");
    console.log(`[plugin-sdk] downloading extism-js ${EXTISM_JS_VERSION}...`);
    await download(extismJsURL(), gz);
    const buf = zlib.gunzipSync(fs.readFileSync(gz));
    fs.writeFileSync(extismDest, buf);
    fs.chmodSync(extismDest, 0o755);
    fs.unlinkSync(gz);
  }

  const wasmMergeDest = path.join(cacheDir, "wasm-merge");
  const wasmOptDest = path.join(cacheDir, "wasm-opt");
  if (!fs.existsSync(wasmMergeDest) || !fs.existsSync(wasmOptDest)) {
    const tar = path.join(cacheDir, "binaryen.tar.gz");
    console.log(`[plugin-sdk] downloading binaryen ${BINARYEN_VERSION}...`);
    await download(binaryenURL(), tar);
    execFileSync("tar", ["xzf", tar, "-C", cacheDir]);
    const extracted = path.join(cacheDir, `binaryen-${BINARYEN_VERSION}`);
    fs.copyFileSync(path.join(extracted, "bin", "wasm-merge"), wasmMergeDest);
    fs.copyFileSync(path.join(extracted, "bin", "wasm-opt"), wasmOptDest);
    fs.chmodSync(wasmMergeDest, 0o755);
    fs.chmodSync(wasmOptDest, 0o755);
    // copy lib too — wasm-opt links against libbinaryen.so on linux
    const libSrc = path.join(extracted, "lib");
    if (fs.existsSync(libSrc)) {
      fs.cpSync(libSrc, path.join(cacheDir, "lib"), { recursive: true });
    }
    fs.rmSync(extracted, { recursive: true });
    fs.unlinkSync(tar);
  }

  // owncast-plugin-test + owncast-plugin-serve — built from this repo's
  // host-runtime/ Go sources, published as release assets on
  // github.com/owncast/plugin-sdk. Skip silently if the release doesn't
  // exist yet (dev environments running against a not-yet-released SDK
  // version can substitute their own via tools/bootstrap.sh).
  for (const binary of ["owncast-plugin-test", "owncast-plugin-serve"]) {
    const dest = path.join(cacheDir, binary);
    if (fs.existsSync(dest)) continue;
    try {
      console.log(`[plugin-sdk] downloading ${binary} ${HOST_BINARIES_VERSION}...`);
      await download(hostBinaryURL(binary), dest);
      fs.chmodSync(dest, 0o755);
    } catch (e) {
      // 404 is expected before the first release; other errors get a soft
      // warning so the user sees them but the install still succeeds.
      console.warn(
        `[plugin-sdk] could not fetch ${binary}: ${e.message}\n` +
        `  Build locally via tools/bootstrap.sh, or use the latest GitHub release.`
      );
      // Make sure no partial file is left behind.
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    }
  }

  console.log("[plugin-sdk] toolchain ready");
}

main().catch((e) => {
  console.error("[plugin-sdk] postinstall failed:", e.message);
  process.exit(1);
});
