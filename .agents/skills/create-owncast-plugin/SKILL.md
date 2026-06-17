---
name: create-owncast-plugin
description: "Use this skill whenever someone wants to create, build, scaffold, or set up an Owncast plugin — or just describes new behavior they want in their Owncast chat or server without naming it a 'plugin.' This is the entry point for any new plugin, in any language: a chat bot or auto-responder, a welcome greeter, a word/link filter or moderation action, a moderator button or admin page, a stream-going-live reaction, a fediverse follow/post integration, or a live web overlay or widget (viewer count, chat feed). Casual asks count fully: 'I run an Owncast server and want a bot that…', 'make me something that auto-replies when…', 'add a button so mods can…'. It captures the desired behavior, settles on JavaScript or Python, then hands off to the matching language skill. Skip it only when the language is already chosen (use the JavaScript or Python skill directly), and for general Owncast streaming/install/config help or bots on other platforms like Twitch or Discord."
---

# Create an Owncast plugin (start here)

This is the **router** for building an Owncast plugin. An Owncast plugin can be
written in **JavaScript** or **Python**, and the two SDKs are first-class peers:
the same handlers, APIs, permissions, and `plugin.manifest.json` apply to both —
only the scaffolding command and the language syntax differ. Your job here is
small: understand what the author wants, settle on a language, then load the
matching language skill and follow it to completion. That skill is the full
operating guide (scaffold → write → test → package → hand off the `.ocpkg`).

## Step 1 — Understand what they want (language-agnostic)

Ask the user, in plain language — these answers carry over regardless of language:

1. **What should the plugin be called?** (e.g. "Welcome Bot"). Derive a **slug**:
   lowercase letters, digits, and hyphens only, must start with a letter, max 64
   chars (e.g. `welcome-bot`). If their name can't map to a valid slug, propose
   one and confirm.
2. **What should it do?** Get concrete behavior, not a category — "greet people
   when they join," "delete messages containing a word," "show a live chat
   overlay on a web page," "post to Discord when the stream goes live." Keep it
   small: build the simplest plugin that does what they asked.

Note any behavior that will need a **high-trust permission** (`fediverse.post`,
`videoconfig.write`, `chat.moderate`, `network.fetch` to arbitrary hosts) — the
server admin has to approve those, so flag them to the user early. The exact
intent→handler→API→permission mapping lives in each language skill's **Capability
map**; you don't need to reproduce it here.

## Step 2 — Decide the language

**If the working directory is already a plugin project, match it — don't ask.**
Detect by what's present:

- `package.json` (with `@owncast/plugin-sdk`) or `src/plugin.js` → **JavaScript**
- `pyproject.toml` (with `owncast-plugin-sdk`) or `src/plugin.py` → **Python**

In that case you're editing an existing plugin in place; carry its slug and
language forward.

**Otherwise ask the author which language they prefer.** Both produce identical
plugins, so steer by their comfort and toolchain:

- **JavaScript** — scaffolds with `npx create-owncast-plugin@latest <slug>`;
  builds, tests, and packages through `npm`. Good default for authors already in
  the Node ecosystem.
- **Python** — scaffolds with `owncast-plugin-py new <slug>` (or
  `uvx --from owncast-plugin-sdk owncast-plugin-py new <slug>`); builds, tests,
  and packages through the `owncast-plugin-py` CLI. Good for authors who prefer
  Python. Plugins ship as source (no wasm/compile step for the author).

If they have no preference, pick whichever language they seem most fluent in;
when that's unclear, default to JavaScript (the more widely used SDK) and say so.

## Step 3 — Hand off to the language skill

Load and follow the matching skill — it owns the rest of the workflow end to end
(scaffold, write handlers + manifest, clear placeholders including
`INSTRUCTIONS.md`, run tests, package, and give the user install instructions):

- **JavaScript → `create-owncast-plugin-js`**
- **Python → `create-owncast-plugin-py`**

Don't re-derive the scaffolding commands, capability map, handler list, or
testing details here — they're maintained in those skills so the two languages
stay in sync. Pass along what you learned in Step 1 (the name/slug, the concrete
behavior, and any high-trust permissions you already flagged).

## Where to go deeper

Public docs for authors: <https://owncast.online/docs/plugins> (overview and
[quickstart](https://owncast.online/docs/plugins/quickstart), with JavaScript and
Python tabs). The exhaustive in-repo reference is `docs/PLUGIN_AUTHOR_GUIDE.md`;
worked examples live in `examples/js/` and `examples/python/`.
