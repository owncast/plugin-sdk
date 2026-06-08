# AGENTS.md

Guidance for AI coding agents working in the Owncast plugin SDK.

## Skills

This repo ships reusable, tool-agnostic agent skills under `.agents/skills/`
(the cross-client Agent Skills convention — discovered automatically by
skill-aware agents, and pointed to here for those that aren't).

- **[create-owncast-plugin](.agents/skills/create-owncast-plugin/SKILL.md)** —
  build a complete Owncast plugin from a plain-language description and produce
  an installable `.ocpkg`. Use this whenever someone wants to create, scaffold,
  or build an Owncast plugin (chat bot, chat filter, stream-event responder,
  HTTP page/overlay, admin page, fediverse integration, etc.). Load and follow
  `.agents/skills/create-owncast-plugin/SKILL.md`.

## Repository orientation

- `sdks/js/` — `@owncast/plugin-sdk` (the npm package authors use) and the
  `create-owncast-plugin` scaffolder.
- `host-runtime/` — Go host runtime that loads and runs plugins.
- `examples/js/` — one example plugin per architectural feature.
- `docs/` — `PLUGIN_AUTHOR_GUIDE.md` (exhaustive author reference),
  `ARCHITECTURE.md`, and `WIRE_PROTOCOL.md`.

When the task is "help me build a plugin," prefer the `create-owncast-plugin`
skill over improvising — it encodes the correct workflow, permission mapping,
and gotchas.
