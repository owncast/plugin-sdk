#!/usr/bin/env node
// Downloads extism-js + binaryen tools (wasm-merge, wasm-opt) for the
// current platform into <sdk>/bin/.cache so the build CLI can find them
// without polluting the user's system.
//
// PoC scope: linux-x86_64 + darwin-arm64 + darwin-x86_64 covered. We can
// add windows / linux-arm64 later.

const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const EXTISM_JS_VERSION = "v1.6.0";
const BINARYEN_VERSION = "version_119";

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

  // owncast-plugin-test (the scenario test runner) would also be downloaded
  // here in a real release. For this PoC the binary ships with the repo —
  // build it once via:
  //   cd owncast && go build -o ../tools/owncast-plugin-test ./cmd/owncast-plugin-test
  // and the SDK's `test` subcommand will find it in tools/ via findCacheDir.

  console.log("[plugin-sdk] toolchain ready");
}

main().catch((e) => {
  console.error("[plugin-sdk] postinstall failed:", e.message);
  process.exit(1);
});
