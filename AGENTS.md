# AGENTS.md

Guidance for AI coding agents working in the Owncast plugin SDK.

## Skills

This repo ships reusable, tool-agnostic agent skills under `.agents/skills/`
(the cross-client Agent Skills convention — discovered automatically by
skill-aware agents, and pointed to here for those that aren't).

- **[create-owncast-plugin](.agents/skills/create-owncast-plugin/SKILL.md)** —
  the **router / entry point**. Use this whenever someone wants to create,
  scaffold, or build an Owncast plugin (chat bot, chat filter, stream-event
  responder, HTTP page/overlay, admin page, fediverse integration, etc.) and the
  language isn't already settled. It gathers the author's intent, picks
  JavaScript or Python, and hands off to one of the two language skills below.
- **[create-owncast-plugin-js](.agents/skills/create-owncast-plugin-js/SKILL.md)**
  / **[create-owncast-plugin-py](.agents/skills/create-owncast-plugin-py/SKILL.md)**
  — the per-language playbooks that take a plugin from scaffold to an installable
  `.ocpkg`. Each is self-contained; jump straight to one when the language is
  already known (or you're editing an existing JS/Python plugin in place). These
  are symlinks to the canonical copies bundled in each SDK's scaffolder template
  (`sdks/js/create-owncast-plugin/template/.agents/skills/create-owncast-plugin-js/`,
  `sdks/python/owncast_plugin/template/.agents/skills/create-owncast-plugin-py/`)
  — edit those template files, not the symlinks.

## Repository orientation

- `sdks/js/` — `@owncast/plugin-sdk` (the npm package authors use) and the
  `create-owncast-plugin` scaffolder.
- `host-runtime/` — Go host runtime that loads and runs plugins.
- `examples/js/` — one example plugin per architectural feature.
- `docs/` — `PLUGIN_AUTHOR_GUIDE.md` (exhaustive author reference),
  `ARCHITECTURE.md`, and `WIRE_PROTOCOL.md`.

When the task is "help me build a plugin," prefer these skills over improvising
— they encode the correct workflow, permission mapping, and gotchas. Start at
`create-owncast-plugin` unless the language is already known, then it's
`create-owncast-plugin-js` or `create-owncast-plugin-py`.
