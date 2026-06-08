// JavaScript test API for Owncast plugins.
//
// Lets authors write their __tests__/*.test.js with the full ergonomics of JS
//, loops, helpers, fixtures, computed payloads, shared setup, instead of
// hand-authoring static JSON. Each call to `runScenarios([...])` invokes the
// same `owncast-plugin-test` host binary the JSON scenarios use, so this is
// purely a more pleasant authoring layer over the same execution.
//
// Quick start:
//
//   const { runScenarios } = require("@owncast/plugin-sdk/testing");
//
//   const chat = (name, body) => ({
//     event: "chat.message.received",
//     payload: { id: "1", user: { id: name, displayName: name }, body, timestamp: "2024-01-01T00:00:00Z" },
//   });
//
//   runScenarios([
//     { name: "greets users",   events: [chat("alice", "hi")],   expect: { chatSends: ["hello, alice!"] } },
//     { name: "ignores others", events: [chat("bob", "morning")], expect: { chatSends: [] } },
//   ]);
//
// Each scenario object has the same shape as a JSON scenario file:
//   { name, given?, events: [...], expect?: {...} }
// See the Plugin Author Guide for every assertion field.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Find the directory holding the owncast-plugin-test binary. Check for that
// binary specifically (not just any toolchain file) so we correctly fall
// through to the dev tools/ dir when postinstall has only fetched part of the
// toolchain (e.g., on a not-yet-released SDK version).
// slugifyForTest mirrors the slugify in the build CLI + host SDKs so
// this entrypoint can locate the .wasm file when a manifest omits
// `slug`. ASCII letters and digits pass through lowercased;
// everything else collapses to a single hyphen; trailing hyphens are
// trimmed.
function slugifyForTest(input) {
  let out = "";
  let prevHyphen = false;
  for (const ch of input) {
    const code = ch.codePointAt(0);
    let lower = ch;
    if (code >= 65 && code <= 90) lower = String.fromCodePoint(code + 32);
    const lc = lower.codePointAt(0);
    if ((lc >= 97 && lc <= 122) || (lc >= 48 && lc <= 57)) {
      out += lower;
      prevHyphen = false;
    } else if (!prevHyphen && out.length > 0) {
      out += "-";
      prevHyphen = true;
    }
  }
  return out.replace(/-+$/, "");
}

function findCacheDir() {
  const candidates = [
    path.join(__dirname, "bin", ".cache"), // installed under node_modules
    path.join(__dirname, "..", "..", "tools"), // dev fallback (repo root tools/)
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "owncast-plugin-test"))) return c;
  }
  return candidates[0];
}

/**
 * Run an array of scenarios against the loaded plugin via the
 * `owncast-plugin-test` host binary.
 *
 * The binary takes a project directory and auto-discovers
 * `__tests__/*.test.json`. To avoid colliding with any JSON scenarios you
 * might also have in the project, this function sets up a temporary project
 * dir that links to your manifest + wasm and contains only the generated
 * scenarios it's running.
 *
 * Sets `process.exitCode` to non-zero if any scenario failed (never resets a
 * previously-failed code), and returns true on success / false on failure
 * WITHOUT exiting the process. That lets one node process run several test
 * files in a row (see runScenarioFiles); the process ends with the right code
 * once the event loop drains.
 *
 * @param {Array<object>} scenarios, scenario objects: { name, given?, events, expect? }
 * @param {object}        [opts]
 * @param {string}        [opts.cwd], plugin project directory (default: process.cwd())
 * @returns {boolean} true if every scenario passed
 */
function fail(code) {
  // Record a non-zero exit code without clobbering an earlier failure or
  // aborting sibling test files. Returns false for `return fail(...)`.
  if (!process.exitCode) process.exitCode = code;
  return false;
}

function runScenarios(scenarios, opts = {}) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    console.error("runScenarios: no scenarios provided");
    return fail(2);
  }

  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const manifestPath = path.join(cwd, "plugin.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`plugin.manifest.json not found in ${cwd}`);
    return fail(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.name) {
    console.error("manifest.name is required");
    return fail(2);
  }
  // wasm + symlink filenames key off slug (the identifier), not the
  // display name. Derive the slug here the same way the build CLI
  // does so this entrypoint works on manifests that omit `slug`.
  const slug = manifest.slug || slugifyForTest(manifest.name);
  if (!slug) {
    console.error(
      `could not derive slug from manifest.name ${JSON.stringify(manifest.name)}; set manifest.slug explicitly`,
    );
    return fail(2);
  }
  const wasmPath = path.join(cwd, `${slug}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    console.error(
      `${slug}.wasm not found at ${wasmPath}, run \`owncast-plugin package\` first`,
    );
    return fail(2);
  }

  const cache = findCacheDir();
  const bin = path.join(cache, "owncast-plugin-test");
  if (!fs.existsSync(bin)) {
    console.error(
      `owncast-plugin-test not found at ${bin}\n` +
        `Reinstall @owncast/plugin-sdk to fetch the host toolchain (postinstall handles it).`,
    );
    return fail(2);
  }

  // Build a temp project dir that links to the wasm + manifest and contains
  // only the scenarios we're running. The binary will auto-discover them.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "owncast-plugin-test-"));
  try {
    fs.symlinkSync(manifestPath, path.join(tmp, "plugin.manifest.json"));
    fs.symlinkSync(wasmPath, path.join(tmp, `${slug}.wasm`));
    fs.mkdirSync(path.join(tmp, "__tests__"));
    fs.writeFileSync(
      path.join(tmp, "__tests__", "scenarios.test.json"),
      JSON.stringify(scenarios, null, 2),
    );

    // Match the build CLI: extism-js (and its wasm-merge/wasm-opt
    // children) needs LD_LIBRARY_PATH on Linux and DYLD_LIBRARY_PATH +
    // DYLD_FALLBACK_LIBRARY_PATH on macOS to find libbinaryen via
    // @rpath. Setting all three is safe on both OSes; the inactive
    // ones are ignored.
    const libDir = path.join(cache, "lib");
    const env = {
      ...process.env,
      LD_LIBRARY_PATH: `${libDir}:${process.env.LD_LIBRARY_PATH || ""}`,
      DYLD_LIBRARY_PATH: `${libDir}:${process.env.DYLD_LIBRARY_PATH || ""}`,
      DYLD_FALLBACK_LIBRARY_PATH: `${libDir}:${process.env.DYLD_FALLBACK_LIBRARY_PATH || "/usr/local/lib:/usr/lib"}`,
    };
    try {
      execFileSync(bin, [tmp], { stdio: "inherit", env });
    } catch (e) {
      return fail(typeof e.status === "number" ? e.status : 1);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return true;
}

/**
 * Discover and run every `__tests__/*.test.js` file in one node process,
 * aggregating their exit status. Lets you organize scenarios across multiple
 * files (by module/feature) without a shell loop spawning a process per file.
 * Each discovered file is expected to call runScenarios() at load time.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd], plugin project directory (default: process.cwd())
 * @returns {boolean} true if every file's scenarios passed
 */
function runScenarioFiles(opts = {}) {
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const dir = path.join(cwd, "__tests__");
  if (!fs.existsSync(dir)) {
    console.error(`no __tests__ directory in ${cwd}`);
    return fail(2);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.js"))
    .sort()
    .map((f) => path.join(dir, f));
  if (files.length === 0) {
    console.error(`no *.test.js files in ${dir}`);
    return fail(2);
  }
  for (const f of files) {
    // Each file runs its own runScenarios() at require time, which records a
    // non-zero process.exitCode on failure but no longer aborts the process.
    require(f);
  }
  return !process.exitCode;
}

module.exports = { runScenarios, runScenarioFiles };
