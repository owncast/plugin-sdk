#!/usr/bin/env node
// `owncast-plugin build`  , bundle src/plugin.{js,ts} into <slug>.wasm
// `owncast-plugin test`   , run scenarios in __tests__/ against the wasm
// `owncast-plugin serve`  , run a localhost dev HTTP server
// `owncast-plugin package`, produce a single-file <slug>.ocpkg suitable
//                            for distribution / installation
//
// "Slug" is the plugin's identifier: lowercase, hyphenated, used in
// filenames, URL segments, and as the registry's primary key. Plugin
// authors set the human-readable display name via `name` in their
// manifest; if they don't set `slug`, the CLI auto-derives it from
// `name`.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const esbuild = require("esbuild");
const JSZip = require("jszip");

const cmd = process.argv[2] || "build";
const restArgs = process.argv.slice(3);

function fail(e) {
  console.error(`${cmd} failed: ${e.message}`);
  process.exit(1);
}

// toolchainEnv extends the current environment with the variables
// the dynamic linker needs to find `libbinaryen` next to `wasm-merge`
// and `wasm-opt` (which extism-js shells out to during the wasm
// pipeline). Linux uses LD_LIBRARY_PATH; macOS uses DYLD_LIBRARY_PATH
// plus DYLD_FALLBACK_LIBRARY_PATH (Apple Silicon strips
// DYLD_LIBRARY_PATH in some sandboxed contexts, the FALLBACK
// variant survives). Setting all three is safe on both OSes; the
// inactive ones are ignored. This is the difference between "build
// succeeds" and `library not loaded: @rpath/libbinaryen.dylib` on
// macOS.
function toolchainEnv(cache) {
  const libDir = path.join(cache, "lib");
  return {
    ...process.env,
    PATH: `${cache}:${process.env.PATH}`,
    LD_LIBRARY_PATH: `${libDir}:${process.env.LD_LIBRARY_PATH || ""}`,
    DYLD_LIBRARY_PATH: `${libDir}:${process.env.DYLD_LIBRARY_PATH || ""}`,
    DYLD_FALLBACK_LIBRARY_PATH: `${libDir}:${process.env.DYLD_FALLBACK_LIBRARY_PATH || "/usr/local/lib:/usr/lib"}`,
  };
}

// slugPattern matches a valid plugin slug: a lowercase letter
// followed by lowercase letters/digits/hyphens, up to 64 chars total.
// Same shape the host + SDK + registry all validate against.
const slugPattern = /^[a-z][a-z0-9-]{0,63}$/;

// slugify mirrors the host's Go slugify: ASCII letters and digits
// pass through lowercased; everything else collapses to a single
// hyphen; leading and trailing hyphens are trimmed.
// Non-ASCII names (e.g. "Café") degrade noisily (-> "caf"); plugins
// with accented or non-Latin display names should pin `slug` in the
// manifest instead of relying on auto-derivation.
function slugify(input) {
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

// readAndResolveManifest loads plugin.manifest.json, validates the
// required fields, and returns a manifest object with `slug` filled
// in: either the author's explicit `slug`, or one auto-derived from
// `name`. The returned object is what gets baked into MANIFEST_BASE
// in the build's synthesized entry, so register() always emits both
// name (display) and slug (identifier).
function readAndResolveManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error("manifest.name is required");
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    throw new Error("manifest.version is required");
  }
  let slug = manifest.slug;
  if (!slug) {
    slug = slugify(manifest.name);
    if (!slug) {
      throw new Error(
        `could not derive a slug from manifest.name ${JSON.stringify(manifest.name)}; set manifest.slug explicitly`,
      );
    }
  }
  if (!slugPattern.test(slug)) {
    throw new Error(
      `manifest.slug ${JSON.stringify(slug)} must match ${slugPattern} (lowercase letters/digits/hyphens, starting with a letter, max 64 chars)`,
    );
  }
  manifest.slug = slug;
  return manifest;
}

function testMain(args) {
  runBinary("owncast-plugin-test", args);
}

function serveMain(args) {
  runBinary("owncast-plugin-serve", args);
}

function runBinary(name, args) {
  const cache = findCacheDir();
  const bin = path.join(cache, name);
  if (!fs.existsSync(bin)) {
    console.error(
      `${name} not found at ${bin}\n` +
        `In production this is fetched by the SDK postinstall. For the PoC, ` +
        `build it via: cd owncast && go build -o tools/${name} ./cmd/${name}`,
    );
    process.exit(1);
  }
  const env = toolchainEnv(cache);
  try {
    execFileSync(bin, args.length > 0 ? args : [process.cwd()], {
      stdio: "inherit",
      env,
    });
  } catch (e) {
    process.exit(typeof e.status === "number" ? e.status : 1);
  }
}

async function buildMain() {
  const cwd = process.cwd();
  const manifestPath = path.join(cwd, "plugin.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("plugin.manifest.json not found in current directory");
  }
  const manifest = readAndResolveManifest(manifestPath);
  const slug = manifest.slug;

  // Detect entry point.
  let entry = null;
  for (const candidate of [
    "src/plugin.ts",
    "src/plugin.js",
    "plugin.ts",
    "plugin.js",
  ]) {
    const p = path.join(cwd, candidate);
    if (fs.existsSync(p)) {
      entry = p;
      break;
    }
  }
  if (!entry)
    throw new Error(
      "no plugin source found (expected src/plugin.ts or plugin.js)",
    );

  // Synthesize an entry that injects the manifest, requires user code,
  // then re-exports the SDK runtime exports as wasm-visible exports.
  const buildDir = path.join(cwd, ".owncast-build");
  fs.mkdirSync(buildDir, { recursive: true });
  const synthEntry = path.join(buildDir, "entry.js");
  const manifestJSON = JSON.stringify(manifest);
  // Always emit register/on_event/on_filter as wasm exports. The SDK derives
  // subscriptions at runtime from the plugin's handler methods and merges
  // them into the manifest returned by register(). The host then only calls
  // on_event/on_filter for plugins actually subscribed to that event, so
  // unused exports are harmless.
  const entrySrc = `const sdk = require("@owncast/plugin-sdk");
const MANIFEST_BASE = ${manifestJSON};
require(${JSON.stringify(entry)});
function register() {
  const manifest = Object.assign({}, MANIFEST_BASE, { subscriptions: sdk.describeSubscriptions() });
  Host.outputString(JSON.stringify(manifest));
  return 0;
}
function on_event() {
  const envelope = JSON.parse(Host.inputString());
  sdk.dispatchEvent(envelope);
  return 0;
}
function on_filter() {
  const envelope = JSON.parse(Host.inputString());
  const result = sdk.dispatchFilter(envelope);
  Host.outputString(JSON.stringify(result));
  return 0;
}
function on_http_request() {
  const request = JSON.parse(Host.inputString());
  const response = sdk.dispatchHttp(request);
  Host.outputString(JSON.stringify(response));
  return 0;
}
module.exports = { register, on_event, on_filter, on_http_request };
`;
  fs.writeFileSync(synthEntry, entrySrc);

  // Bundle to a single CJS file targeting the QuickJS runtime extism-js uses.
  const bundledJS = path.join(buildDir, "bundle.js");
  await esbuild.build({
    entryPoints: [synthEntry],
    bundle: true,
    format: "cjs",
    platform: "neutral",
    target: "es2020",
    outfile: bundledJS,
    logLevel: "warning",
  });

  // Generate index.d.ts declaring exports + host imports based on permissions.
  const dts = path.join(buildDir, "index.d.ts");
  fs.writeFileSync(dts, generateInterface(manifest));

  // Find toolchain.
  const cache = findCacheDir();
  const extismJs = path.join(cache, "extism-js");
  if (!fs.existsSync(extismJs)) {
    throw new Error(
      `extism-js not found at ${extismJs}, run \`npm install\` to fetch the toolchain`,
    );
  }
  const env = toolchainEnv(cache);

  const wasmOut = path.join(cwd, `${slug}.wasm`);
  execFileSync(extismJs, [bundledJS, "-i", dts, "-o", wasmOut], {
    stdio: "inherit",
    env,
  });

  // If the project ships static assets in ./assets/, mirror them to the
  // canonical deployment layout (<name>-assets/) so plugin.Server finds them
  // without per-deployment renames. We use a symlink so edits to assets/
  // show up live during dev (no rebuild needed for HTML/CSS changes).
  const assetsSrc = path.join(cwd, "assets");
  if (fs.existsSync(assetsSrc) && fs.statSync(assetsSrc).isDirectory()) {
    const assetsDest = path.join(cwd, `${slug}-assets`);
    let needsLink = true;
    // Use lstatSync (not existsSync), existsSync follows symlinks and
    // returns false for a dangling link, but the link's inode is still
    // there and would make symlinkSync below fail with EEXIST. lstatSync
    // sees the link itself regardless of whether its target resolves.
    let st;
    try {
      st = fs.lstatSync(assetsDest);
    } catch {
      // path doesn't exist at all, fall through to create it.
    }
    if (st) {
      let target;
      if (st.isSymbolicLink()) {
        // realpathSync throws on dangling links; treat that as "doesn't
        // match, replace it" rather than letting it abort the build.
        try {
          target = fs.realpathSync(assetsDest);
        } catch {}
      }
      if (target && target === fs.realpathSync(assetsSrc)) {
        needsLink = false;
      } else {
        fs.rmSync(assetsDest, { recursive: true, force: true });
      }
    }
    if (needsLink) {
      fs.symlinkSync(path.resolve(assetsSrc), assetsDest, "dir");
    }
  }

  console.log(`built ${path.relative(cwd, wasmOut)}`);
}

// `owncast-plugin package`, bundle the project into a single .ocpkg file
// (zip archive with plugin.manifest.json, plugin.wasm, and optional assets/).
// Builds the wasm first if it doesn't exist.
async function packageMain() {
  const cwd = process.cwd();
  const manifestPath = path.join(cwd, "plugin.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("plugin.manifest.json not found in current directory");
  }
  const manifest = readAndResolveManifest(manifestPath);
  const slug = manifest.slug;

  const wasmPath = path.join(cwd, `${slug}.wasm`);
  if (!fs.existsSync(wasmPath)) {
    await buildMain();
  }

  const assetsDir = path.join(cwd, "assets");
  const zip = new JSZip();
  zip.file("plugin.manifest.json", fs.readFileSync(manifestPath));
  zip.file("plugin.wasm", fs.readFileSync(wasmPath));
  let fileCount = 2;
  // Bundle a top-level icon.png if the plugin source root has one.
  // The host reads it from /api/plugins/<slug>/icon to render in the
  // admin list and sidebar (no manifest field, no http.serve
  // permission required).
  const iconPath = path.join(cwd, "icon.png");
  if (fs.existsSync(iconPath) && fs.statSync(iconPath).isFile()) {
    zip.file("icon.png", fs.readFileSync(iconPath));
    fileCount++;
  }
  // Bundle a top-level INSTRUCTIONS.md if the plugin source root has one.
  // The host serves it to the admin (which renders it as markdown in a
  // details tab); like icon.png it needs no manifest field and no
  // http.serve permission. The filename is fixed for simplicity.
  const instructionsPath = path.join(cwd, "INSTRUCTIONS.md");
  if (fs.existsSync(instructionsPath) && fs.statSync(instructionsPath).isFile()) {
    zip.file("INSTRUCTIONS.md", fs.readFileSync(instructionsPath));
    fileCount++;
  }
  if (fs.existsSync(assetsDir) && fs.statSync(assetsDir).isDirectory()) {
    for (const file of walkFiles(assetsDir)) {
      const rel = path.relative(assetsDir, file).split(path.sep).join("/");
      zip.file(`assets/${rel}`, fs.readFileSync(file));
      fileCount++;
    }
  }

  const outPath = path.join(cwd, `${slug}.ocpkg`);
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(outPath, buf);
  const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(
    `packaged ${path.relative(cwd, outPath)} (${sizeKb} KB, ${fileCount} files)`,
  );

  // Drop the intermediate <slug>.wasm now that it's bundled inside the
  // .ocpkg. The .ocpkg is the only artifact authors care about: leaving
  // the loose .wasm next to it just confuses "what do I ship". Only
  // runs on a successful package so a mid-pipeline failure leaves the
  // last good build in place for debugging.
  try {
    fs.unlinkSync(wasmPath);
  } catch (e) {
    // Don't fail the package step over a cleanup miss. The .ocpkg is
    // already written; surface the warning so the author notices the
    // straggler but treat the run as successful.
    if (e.code !== "ENOENT") {
      console.warn(`warning: could not clean up ${path.relative(cwd, wasmPath)}: ${e.message}`);
    }
  }
}

function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Resolve symlinks so the assets/ → <name>-assets/ link the build CLI
    // makes doesn't cause us to skip files. statSync follows.
    const full = path.join(dir, entry.name);
    let info;
    try {
      info = fs.statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      yield* walkFiles(full);
    } else if (info.isFile()) {
      yield full;
    }
  }
}

function generateInterface(manifest) {
  const exports = [
    "register(): I32",
    "on_event(): I32",
    "on_filter(): I32",
    "on_http_request(): I32",
  ];

  const perms = new Set(manifest.permissions || []);
  const imports = [];
  if (perms.has("chat.send")) {
    imports.push("owncast_send_chat(textPtr: PTR): void");
    imports.push("owncast_send_chat_action(textPtr: PTR): void");
    imports.push("owncast_send_chat_system(bodyPtr: PTR): void");
    imports.push("owncast_send_chat_to(clientId: I64, textPtr: PTR): void");
  }
  if (perms.has("chat.history")) {
    imports.push("owncast_chat_history(limit: I32): PTR");
    imports.push("owncast_chat_clients(): PTR");
  }
  if (perms.has("chat.moderate")) {
    imports.push("owncast_delete_message(idPtr: PTR): void");
    imports.push("owncast_kick_client(clientId: I64): void");
  }
  if (perms.has("notifications.send")) {
    imports.push("owncast_notify_discord(textPtr: PTR): void");
    imports.push("owncast_notify_browser_push(payloadPtr: PTR): void");
    imports.push("owncast_notify_fediverse(payloadPtr: PTR): void");
  }
  if (perms.has("users.read")) {
    imports.push("owncast_users_list(): PTR");
    imports.push("owncast_user_get(idPtr: PTR): PTR");
  }
  if (perms.has("users.moderate")) {
    imports.push(
      "owncast_user_set_enabled(idPtr: PTR, enabled: I32, reasonPtr: PTR): void",
    );
    imports.push("owncast_ban_ip(ipPtr: PTR): void");
  }
  if (perms.has("storage.upload")) {
    imports.push("owncast_storage_upload(namePtr: PTR, dataPtr: PTR): PTR");
  }
  if (perms.has("fediverse.post")) {
    imports.push("owncast_fediverse_post(textPtr: PTR): PTR");
  }
  if (perms.has("storage.kv")) {
    imports.push("owncast_kv_get(keyPtr: PTR): PTR");
    imports.push("owncast_kv_set(keyPtr: PTR, valPtr: PTR): void");
  }
  if (perms.has("events.emit"))
    imports.push(
      "owncast_emit_event(eventTypePtr: PTR, payloadPtr: PTR): void",
    );
  if (perms.has("http.sse"))
    imports.push(
      "owncast_sse_send(channelPtr: PTR, eventPtr: PTR, dataPtr: PTR): void",
    );
  if (perms.has("server.read")) {
    imports.push("owncast_stream_current(): PTR");
    imports.push("owncast_server_info(): PTR");
    imports.push("owncast_server_socials(): PTR");
    imports.push("owncast_server_federation(): PTR");
    imports.push("owncast_stream_broadcaster(): PTR");
    imports.push("owncast_server_tags(): PTR");
  }
  if (perms.has("videoconfig.read")) {
    imports.push("owncast_video_config_read(): PTR");
  }
  if (perms.has("videoconfig.write")) {
    imports.push("owncast_video_config_write(configPtr: PTR): PTR");
  }
  if (perms.has("ui.modify")) {
    imports.push("owncast_add_actions(actionsPtr: PTR): void");
    imports.push("owncast_clear_actions(): void");
  }

  let out = `declare module 'main' {\n`;
  for (const e of exports) out += `  export function ${e};\n`;
  out += `}\n`;
  if (imports.length > 0) {
    out += `\ndeclare module 'extism:host' {\n  interface user {\n`;
    for (const i of imports) out += `    ${i};\n`;
    out += `  }\n}\n`;
  }
  return out;
}

function findCacheDir() {
  // Look in node_modules/@owncast/plugin-sdk/bin/.cache (when used as a dep)
  // and in the repo's tools/ dir (when developing). The dev candidate
  // assumes Node resolved __dirname through any symlink to the real SDK
  // path (sdks/js/bin/), then walks up to the repo root.
  const candidates = [
    path.join(__dirname, ".cache"),
    path.join(__dirname, "..", "bin", ".cache"),
    path.join(__dirname, "..", "..", "..", "tools"),
  ];
  // Pick the first candidate that has any of the expected tools, different
  // commands need different binaries (build needs extism-js, test needs
  // owncast-plugin-test) but they share a cache.
  for (const c of candidates) {
    if (
      fs.existsSync(path.join(c, "extism-js")) ||
      fs.existsSync(path.join(c, "owncast-plugin-test")) ||
      fs.existsSync(path.join(c, "owncast-plugin-serve"))
    ) {
      return c;
    }
  }
  return candidates[0];
}

// Dispatch sits at the bottom so every const + function above is
// fully initialized before any handler runs. Calling a handler from
// the top of the file would put the top-level `const slugPattern`
// (and friends) in the TDZ for the first synchronous slice of
// buildMain/packageMain.
if (cmd === "build") {
  buildMain().catch(fail);
} else if (cmd === "test") {
  testMain(restArgs);
} else if (cmd === "serve") {
  serveMain(restArgs);
} else if (cmd === "package") {
  packageMain().catch(fail);
} else {
  console.error(
    `unknown command: ${cmd}\nusage: owncast-plugin <build|test|serve|package>`,
  );
  process.exit(1);
}
