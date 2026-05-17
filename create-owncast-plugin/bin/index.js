#!/usr/bin/env node
// `npm create owncast-plugin <name>` scaffolder. Copies the template tree,
// substitutes <name> into package.json + plugin.manifest.json, and prints
// next-step instructions.

const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!target) {
  console.error("usage: npm create owncast-plugin <plugin-name>");
  process.exit(1);
}

const dest = path.resolve(process.cwd(), target);
if (fs.existsSync(dest)) {
  console.error(`error: ${dest} already exists`);
  process.exit(1);
}

const templateDir = path.join(__dirname, "..", "template");

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    let content = fs.readFileSync(src, "utf8");
    content = content.replaceAll("__PLUGIN_NAME__", path.basename(target));
    fs.writeFileSync(dst, content);
  }
}

copyRecursive(templateDir, dest);

console.log(`Created ${dest}`);
console.log("");
console.log("Next steps:");
console.log(`  cd ${target}`);
console.log("  npm install");
console.log("  npm run build");
console.log(`  # produces ${path.basename(target)}.wasm + plugin.manifest.json`);
