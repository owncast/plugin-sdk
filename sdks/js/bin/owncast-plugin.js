#!/usr/bin/env node
// `owncast-plugin build`  , bundle src/plugin.{js,ts} into <slug>.js
// `owncast-plugin test`   , run scenarios in __tests__/ against the plugin
// `owncast-plugin serve`  , run a localhost dev HTTP server
// `owncast-plugin package`, produce a single-file <slug>.ocpkg suitable
//                            for distribution / installation
//
// "Slug" is the plugin's identifier: lowercase, hyphenated, used in
// filenames, URL segments, and as the registry's primary key. Plugin
// authors set the human-readable display name via `name` in their
// manifest. If they don't set `slug`, the CLI auto-derives it from
// `name`.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const esbuild = require("esbuild");
const JSZip = require("jszip");
const { slugify } = require("../slug");

const cmd = process.argv[2] || "build";
const restArgs = process.argv.slice(3);

function fail(e) {
  console.error(`${cmd} failed: ${e.message}`);
  process.exit(1);
}

// slugPattern matches a valid plugin slug: a lowercase letter
// followed by lowercase letters/digits/hyphens, up to 64 chars total.
// Same shape the host + SDK + registry all validate against.
const slugPattern = /^[a-z][a-z0-9-]{0,63}$/;

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
  try {
    execFileSync(bin, args.length > 0 ? args : [process.cwd()], {
      stdio: "inherit",
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

  // Shared-engine model: bundle the author's plugin into a tiny CommonJS
  // script with @owncast/plugin-sdk marked EXTERNAL. It ships in the .ocpkg as
  // plugin.js. The host infers the JavaScript runtime from that filename and
  // runs it on the embedded JS engine, which provides
  // require("@owncast/plugin-sdk"). No per-plugin wasm, no extism-js.
  const buildDir = path.join(cwd, ".owncast-build");
  fs.mkdirSync(buildDir, { recursive: true });
  const scriptOut = path.join(cwd, `${slug}.js`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    platform: "neutral",
    target: "es2020",
    external: ["@owncast/plugin-sdk"],
    outfile: scriptOut,
    logLevel: "warning",
  });

  // public/ and assets/ live at the source root, and the packager picks them up.
  console.log(`built ${path.relative(cwd, scriptOut)}`);
}

// `owncast-plugin package`, bundle the project into a single .ocpkg file
// (zip archive with plugin.manifest.json, plugin.js source, and optional
// public/ and assets/ directories). Builds the source first if it
// doesn't exist.
async function packageMain() {
  const cwd = process.cwd();
  const manifestPath = path.join(cwd, "plugin.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("plugin.manifest.json not found in current directory");
  }
  const manifest = readAndResolveManifest(manifestPath);
  const slug = manifest.slug;

  const scriptPath = path.join(cwd, `${slug}.js`);
  if (!fs.existsSync(scriptPath)) {
    await buildMain();
  }

  // The code entry's name (plugin.js) is what tells the host this is a
  // JavaScript plugin, so there is no "type" field in the manifest. The
  // manifest ships verbatim.
  const publicDir = path.join(cwd, "public");
  const assetsDir = path.join(cwd, "assets");
  const zip = new JSZip();
  zip.file("plugin.manifest.json", fs.readFileSync(manifestPath));
  zip.file("plugin.js", fs.readFileSync(scriptPath));
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
  // details tab). Like icon.png it needs no manifest field and no
  // http.serve permission. The filename is fixed for simplicity.
  const instructionsPath = path.join(cwd, "INSTRUCTIONS.md");
  if (fs.existsSync(instructionsPath) && fs.statSync(instructionsPath).isFile()) {
    zip.file("INSTRUCTIONS.md", fs.readFileSync(instructionsPath));
    fileCount++;
  }
  // public/ → /plugins/<slug>/<path>, served by the host.
  if (fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory()) {
    for (const file of walkFiles(publicDir)) {
      const rel = path.relative(publicDir, file).split(path.sep).join("/");
      zip.file(`public/${rel}`, fs.readFileSync(file));
      fileCount++;
    }
  }
  // assets/ → host reads internally for manifest fields that inline
  // file contents (styles, scripts, extraPageContent). Not served at
  // a URL.
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

  // Drop the intermediate <slug>.js now that it's bundled inside the
  // .ocpkg. The .ocpkg is the only artifact authors care about: leaving
  // the loose script next to it just confuses "what do I ship". Only
  // runs on a successful package so a mid-pipeline failure leaves the
  // last good build in place for debugging.
  try {
    fs.unlinkSync(scriptPath);
  } catch (e) {
    // Don't fail the package step over a cleanup miss. The .ocpkg is
    // already written, so surface the warning so the author notices the
    // straggler but treat the run as successful.
    if (e.code !== "ENOENT") {
      console.warn(`warning: could not clean up ${path.relative(cwd, scriptPath)}: ${e.message}`);
    }
  }
}

function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // statSync (not lstatSync) so a symlinked file or directory in
    // the source tree resolves to its target and we read its contents
    // rather than skipping it.
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
  // Pick the first candidate that has the prebuilt host binaries (the only
  // tooling the SDK ships now, since `build` is pure esbuild and needs nothing here).
  for (const c of candidates) {
    if (
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
