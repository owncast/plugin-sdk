// Builds the shared JS engine (engine.wasm) from engines/js/entry.js and copies
// it into Owncast's embed directory. Run via `make engines` (or directly:
// `node engines/build.mjs [outDir]`).
//
// The engine bundles the SDK runtime (sdks/js/index.js) + the fixed dispatch
// bootstrap, then extism-js compiles it once. The result is byte-identical for
// every JS plugin; plugins ship only their author script (see the build CLI).
import { build } from "../sdks/js/node_modules/esbuild/lib/main.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const sdk = path.join(repo, "sdks/js");
// Engine-build toolchain (extism-js + binaryen), fetched by install-toolchain.mjs
// (run via `make`). Kept separate from the SDK's author-facing install, which no
// longer ships any wasm tooling.
const cache = path.join(here, ".toolchain");
const extismJs = path.join(cache, "extism-js");

// Default output: Owncast's embed dir (sibling checkout). Override with arg 1
// or OWNCAST_ENGINE_DIR.
const outDir =
  process.argv[2] ||
  process.env.OWNCAST_ENGINE_DIR ||
  path.resolve(repo, "../owncast/services/plugins/engines/javascript");

const buildDir = path.join(here, ".build");
fs.mkdirSync(buildDir, { recursive: true });

// 1) Bundle entry.js with the SDK inlined (alias the bare specifier to the SDK).
const bundle = path.join(buildDir, "engine-bundle.js");
await build({
  entryPoints: [path.join(here, "javascript/entry.js")],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  target: "es2020",
  outfile: bundle,
  alias: { "@owncast/plugin-sdk": path.join(sdk, "index.js") },
  logLevel: "warning",
});

// 2) Compile to wasm via extism-js (engine-build-only toolchain).
if (!fs.existsSync(extismJs)) {
  throw new Error(`extism-js not found at ${extismJs} — run \`make\` (or \`node install-toolchain.mjs\`) in engines/ first`);
}
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "engine.wasm");
execFileSync(extismJs, [bundle, "-i", path.join(here, "javascript/engine.d.ts"), "-o", out], {
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: `${path.join(repo, "tools")}:${cache}:${process.env.PATH}`,
    LD_LIBRARY_PATH: path.join(cache, "lib"),
  },
});
console.log(`built JS engine: ${out} (${fs.statSync(out).size} bytes)`);
