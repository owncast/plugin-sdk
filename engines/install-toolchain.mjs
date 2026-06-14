// Fetches the engine-build toolchain (extism-js + binaryen) into engines/.toolchain.
// This is a MAINTAINER tool, run by `make` before compiling the engines — it is
// NOT part of an author's install. Authors ship plugin source and never touch
// extism-js or binaryen; the only thing `npm install @owncast/plugin-sdk`
// fetches is the test/serve binaries (see sdks/js/scripts/postinstall.js).
//
// Idempotent: skips anything already present. Covers linux-x86_64 +
// darwin-(arm64|x86_64), matching the platforms the engine wasms are built on.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXTISM_JS_VERSION = "v1.6.0";
const BINARYEN_VERSION = "version_119";

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(here, ".toolchain");

function platformKey() {
  const p = process.platform;
  const a = process.arch;
  if (p === "linux" && a === "x64") return "linux-x86_64";
  if (p === "linux" && a === "arm64") return "linux-aarch64";
  if (p === "darwin" && a === "x64") return "darwin-x86_64";
  if (p === "darwin" && a === "arm64") return "darwin-arm64";
  throw new Error(`unsupported platform: ${p}/${a}`);
}

function extismJsURL() {
  const map = {
    "linux-x86_64": `extism-js-x86_64-linux-${EXTISM_JS_VERSION}.gz`,
    "linux-aarch64": `extism-js-aarch64-linux-${EXTISM_JS_VERSION}.gz`,
    "darwin-x86_64": `extism-js-x86_64-macos-${EXTISM_JS_VERSION}.gz`,
    "darwin-arm64": `extism-js-aarch64-macos-${EXTISM_JS_VERSION}.gz`,
  };
  return `https://github.com/extism/js-pdk/releases/download/${EXTISM_JS_VERSION}/${map[platformKey()]}`;
}

function binaryenURL() {
  const map = {
    "linux-x86_64": `binaryen-${BINARYEN_VERSION}-x86_64-linux.tar.gz`,
    "linux-aarch64": `binaryen-${BINARYEN_VERSION}-aarch64-linux.tar.gz`,
    "darwin-x86_64": `binaryen-${BINARYEN_VERSION}-x86_64-macos.tar.gz`,
    "darwin-arm64": `binaryen-${BINARYEN_VERSION}-arm64-macos.tar.gz`,
  };
  return `https://github.com/WebAssembly/binaryen/releases/download/${BINARYEN_VERSION}/${map[platformKey()]}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = (u) =>
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return req(res.headers.location);
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
  fs.mkdirSync(cacheDir, { recursive: true });

  const extismDest = path.join(cacheDir, "extism-js");
  if (!fs.existsSync(extismDest)) {
    const gz = path.join(cacheDir, "extism-js.gz");
    console.log(`[engines] downloading extism-js ${EXTISM_JS_VERSION}...`);
    await download(extismJsURL(), gz);
    fs.writeFileSync(extismDest, zlib.gunzipSync(fs.readFileSync(gz)));
    fs.chmodSync(extismDest, 0o755);
    fs.unlinkSync(gz);
  }

  const wasmMerge = path.join(cacheDir, "wasm-merge");
  const wasmOpt = path.join(cacheDir, "wasm-opt");
  if (!fs.existsSync(wasmMerge) || !fs.existsSync(wasmOpt)) {
    const tar = path.join(cacheDir, "binaryen.tar.gz");
    console.log(`[engines] downloading binaryen ${BINARYEN_VERSION}...`);
    await download(binaryenURL(), tar);
    execFileSync("tar", ["xzf", tar, "-C", cacheDir]);
    const extracted = path.join(cacheDir, `binaryen-${BINARYEN_VERSION}`);
    fs.copyFileSync(path.join(extracted, "bin", "wasm-merge"), wasmMerge);
    fs.copyFileSync(path.join(extracted, "bin", "wasm-opt"), wasmOpt);
    fs.chmodSync(wasmMerge, 0o755);
    fs.chmodSync(wasmOpt, 0o755);
    const libSrc = path.join(extracted, "lib");
    if (fs.existsSync(libSrc)) fs.cpSync(libSrc, path.join(cacheDir, "lib"), { recursive: true });
    fs.rmSync(extracted, { recursive: true });
    fs.unlinkSync(tar);
  }

  console.log("[engines] toolchain ready in engines/.toolchain");
}

main().catch((e) => {
  console.error("[engines] toolchain install failed:", e.message);
  process.exit(1);
});
