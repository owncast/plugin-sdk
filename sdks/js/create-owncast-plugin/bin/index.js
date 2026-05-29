#!/usr/bin/env node
// `npm create owncast-plugin <slug>` scaffolder. Copies the template tree,
// substitutes the slug + a humanized display name into package.json and
// plugin.manifest.json, and prints next-step instructions.

const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!target) {
  console.error("usage: npm create owncast-plugin <plugin-slug>");
  process.exit(1);
}

const dest = path.resolve(process.cwd(), target);
if (fs.existsSync(dest)) {
  console.error(`error: ${dest} already exists`);
  process.exit(1);
}

const slug = path.basename(target);
if (!/^[a-z][a-z0-9-]{0,63}$/.test(slug)) {
  console.error(
    `error: ${slug} is not a valid plugin slug.\n` +
      `Slugs must be lowercase letters, digits, or hyphens, start with a letter, max 64 chars (e.g. "my-cool-bot").`,
  );
  process.exit(1);
}

// humanize "my-cool-plugin" -> "My Cool Plugin" as a starting
// display name. Authors can edit plugin.manifest.json afterwards.
const displayName = slug
  .split("-")
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

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
    content = content
      .replaceAll("__PLUGIN_SLUG__", slug)
      .replaceAll("__PLUGIN_DISPLAY_NAME__", displayName);
    fs.writeFileSync(dst, content);
  }
}

copyRecursive(templateDir, dest);

console.log(`Created ${dest}`);
console.log("");
console.log(`Plugin slug: ${slug}`);
console.log(`Display name: ${displayName} (edit plugin.manifest.json to change)`);
console.log("");
console.log("Next steps:");
console.log(`  cd ${target}`);
console.log("  npm install");
console.log("  npm run package");
