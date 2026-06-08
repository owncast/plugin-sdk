#!/usr/bin/env node
// Downloads per-platform tooling into <sdk>/bin/.cache so the build CLI
// finds it without polluting the user's system:
//
//   - extism-js                 , JS → wasm compiler (extism/js-pdk releases)
//   - wasm-merge, wasm-opt, lib , binaryen post-processing (WebAssembly/binaryen releases)
//   - owncast-plugin-test/serve , scenario runner + dev server (this repo's releases)
//
// PoC scope: linux-x86_64 + darwin-arm64 + darwin-x86_64 covered.
// owncast-plugin-test/serve downloads gracefully skip if the matching
// release asset isn't published yet, dev builds can substitute their own
// via tools/bootstrap.sh.

const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const EXTISM_JS_VERSION = "v1.6.0";
const BINARYEN_VERSION = "version_119";
const HOST_BINARIES_REPO = "owncast/plugin-sdk";

// The host binaries (owncast-plugin-test/serve) implement the host-function
// contract that the bundled JS runtime imports. That contract is additive
// within a major version — host functions are only ever added, never removed or
// renamed (a removal is a breaking change that requires a major bump) — so the
// NEWEST published binary is compatible with every plugin runtime. We therefore
// fetch the latest release tag rather than deriving one from the npm version.
//
// This keeps the binary in lockstep with `@owncast/plugin-sdk@^x` (which npm
// already floats to the newest compatible runtime) and fixes the old "zero the
// patch" guess: that fetched v<major>.<minor>.0, which 404'd on JS-only patches
// and — when a host change shipped in a patch (e.g. timer support in 0.4.2) —
// fetched a binary too old to satisfy the runtime's imports, breaking
// `npm test`.
//
// Override with OWNCAST_PLUGIN_HOST_BINARIES_VERSION (with or without a leading
// "v") to pin a specific tag, e.g. in CI or when bisecting.
function latestReleaseTag() {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://api.github.com/repos/${HOST_BINARIES_REPO}/releases/latest`,
        {
          headers: {
            "User-Agent": "owncast-plugin-sdk-postinstall",
            Accept: "application/vnd.github+json",
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              const tag = JSON.parse(body).tag_name;
              if (!tag) return reject(new Error("no tag_name in response"));
              resolve(tag);
            } catch (err) {
              reject(err);
            }
          });
        },
      )
      .on("error", reject);
  });
}

async function resolveHostBinariesVersion() {
  const override = process.env.OWNCAST_PLUGIN_HOST_BINARIES_VERSION;
  if (override) return override.replace(/^v/i, "");
  try {
    return (await latestReleaseTag()).replace(/^v/i, "");
  } catch (e) {
    // Offline or API error: best-effort fall back to this package's own
    // version. The download below 404-skips gracefully if no such release.
    const pkg = require("../package.json").version;
    console.warn(
      `[plugin-sdk] could not resolve latest host-binary release ` +
        `(${e.message}); falling back to v${pkg}`,
    );
    return pkg;
  }
}

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
    "darwin-arm64": `extism-js-aarch64-macos-${EXTISM_JS_VERSION}.gz`,
  };
  const file = map[platformKey()];
  return `https://github.com/extism/js-pdk/releases/download/${EXTISM_JS_VERSION}/${file}`;
}

function binaryenURL() {
  const map = {
    "linux-x86_64": `binaryen-${BINARYEN_VERSION}-x86_64-linux.tar.gz`,
    "linux-aarch64": `binaryen-${BINARYEN_VERSION}-aarch64-linux.tar.gz`,
    "darwin-x86_64": `binaryen-${BINARYEN_VERSION}-x86_64-macos.tar.gz`,
    "darwin-arm64": `binaryen-${BINARYEN_VERSION}-arm64-macos.tar.gz`,
  };
  const file = map[platformKey()];
  return `https://github.com/WebAssembly/binaryen/releases/download/${BINARYEN_VERSION}/${file}`;
}

function hostBinaryURL(name, version) {
  // Per-platform asset naming matches Go's GOOS-GOARCH convention so the
  // release CI can `go build` once per matrix entry without renaming.
  const map = {
    "linux-x86_64": "linux-amd64",
    "linux-aarch64": "linux-arm64",
    "darwin-x86_64": "darwin-amd64",
    "darwin-arm64": "darwin-arm64",
  };
  const suffix = map[platformKey()];
  return `https://github.com/${HOST_BINARIES_REPO}/releases/download/v${version}/${name}-${suffix}`;
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = (u) =>
      https.get(u, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301)
          return req(res.headers.location);
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
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
    // copy lib too, wasm-opt links against libbinaryen.so on linux
    const libSrc = path.join(extracted, "lib");
    if (fs.existsSync(libSrc)) {
      fs.cpSync(libSrc, path.join(cacheDir, "lib"), { recursive: true });
    }
    fs.rmSync(extracted, { recursive: true });
    fs.unlinkSync(tar);
  }

  // owncast-plugin-test + owncast-plugin-serve, built from this repo's
  // host-runtime/ Go sources, published as gzipped release assets on
  // github.com/owncast/plugin-sdk (roughly halves the download). Skip silently
  // if the release doesn't exist yet (dev environments running against a
  // not-yet-released SDK version can substitute their own via
  // tools/bootstrap.sh).
  const hostBinaries = ["owncast-plugin-test", "owncast-plugin-serve"];
  const missing = hostBinaries.filter(
    (b) => !fs.existsSync(path.join(cacheDir, b)),
  );
  if (missing.length) {
    // Resolve the version only when something needs downloading, so a repeat
    // install with a populated cache never hits the network.
    const version = await resolveHostBinariesVersion();
    for (const binary of missing) {
      const dest = path.join(cacheDir, binary);
      const gz = dest + ".gz";
      try {
        console.log(`[plugin-sdk] downloading ${binary} v${version}...`);
        await download(hostBinaryURL(binary, version) + ".gz", gz);
        fs.writeFileSync(dest, zlib.gunzipSync(fs.readFileSync(gz)));
        fs.chmodSync(dest, 0o755);
        fs.unlinkSync(gz);
      } catch (e) {
        // 404 is expected before the first release; other errors get a soft
        // warning so the user sees them but the install still succeeds.
        console.warn(
          `[plugin-sdk] could not fetch ${binary}: ${e.message}\n` +
            `  Build locally via tools/bootstrap.sh, or use the latest GitHub release.`,
        );
        // Make sure no partial files are left behind.
        for (const p of [gz, dest]) if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
  }

  console.log("[plugin-sdk] toolchain ready");
}

main().catch((e) => {
  console.error("[plugin-sdk] postinstall failed:", e.message);
  process.exit(1);
});
