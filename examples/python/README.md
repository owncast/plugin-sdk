# Python plugin examples

One self-contained plugin per directory, authored in Python and compiled to wasm with `extism-py`. Each is a port of the matching [JavaScript example](../js/). The manifest and behavior are the same, so the [author guide](../../docs/PLUGIN_AUTHOR_GUIDE.md) applies to both. The only difference is the API surface: Python uses decorator-registered handlers (`@plugin.on_chat_message`) and `snake_case` methods (`owncast.chat.send`, `owncast.video_config.read`). The table below maps each example to the SDK feature it covers.

| Plugin                                            | One-line summary                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [hello-world](./hello-world/)                     | Minimum viable plugin, proves the load + `register()` path works.                                       |
| [chat-logger](./chat-logger/)                     | Logs every chat message. The simplest notification handler.                                             |
| [echo-bot](./echo-bot/)                           | Posts a reply to every chat message via `owncast.chat.send`. |
| [mod-commands](./mod-commands/)                   | Declarative `plugin.commands()` table: custom prefix, aliases, moderator gating, cooldowns, ordinary chat-handler composition, and `!help` metadata. |
| [message-counter](./message-counter/)             | Per-user message counter persisted in the plugin's namespaced config.                                   |
| [profanity-filter](./profanity-filter/)           | `filter.modify(payload)`, rewrites flagged words to asterisks.                                          |
| [slow-mode](./slow-mode/)                         | `filter.drop(reason)`, rate-limits per user, with in-memory state.                                      |
| [buggy-filter](./buggy-filter/)                   | Always raises, exercises the host's fail-open + strike system.                                          |
| [relay](./relay/)                                 | Emits a custom `announcement.broadcast` event (plugin → plugin).                                        |
| [announcer](./announcer/)                         | Subscribes to `announcement.broadcast` via `@plugin.on(...)`.                                            |
| [ip-bot](./ip-bot/)                               | Outbound HTTP via `owncast.http.fetch`, mocked in tests.                                                |
| [overlay](./overlay/)                             | `http.serve`, static files from `public/` + dynamic JSON endpoint.                                      |
| [stream-tracker](./stream-tracker/)               | Every typed lifecycle / chat-user handler + read APIs.                                                  |
| [stream-ops](./stream-ops/)                       | Broadcast telemetry (`server.read`) + video config read/write (`videoconfig.read`/`videoconfig.write`). |
| [manual-video-settings](./manual-video-settings/) | Admin form for the video config: latency, codec, and per-variant resolution / framerate / bitrate.      |
| [engagement-bot](./engagement-bot/)               | Discord + browser-push + fediverse notifier on stream / fediverse events, with a small inline spam filter.     |
| [admin-demo](./admin-demo/)                       | `manifest.admin.pages`, host-gated admin routes.                                                        |
| [file-manager](./file-manager/)                   | `storage.fs`, admin page to browse/upload/download/delete files in the plugin's private sandbox.        |
| [action-buttons](./action-buttons/)               | `manifest.actions` + runtime `owncast.actions.add` (ui.modify), with an admin page that adds buttons.   |
| [fediverse-chat-bridge](./fediverse-chat-bridge/) | Inbound fediverse mentions → HTML chat system messages with avatars.                                    |
| [safeguard-stress](./safeguard-stress/)           | Test fixture, misbehaves on demand to verify host sandbox caps.                                         |
| [all-permissions-test](./all-permissions-test/)   | Build/load canary: every permission + every handler as no-ops, fails CI when the host catalog changes. |
| [styles-demo](./styles-demo/)                     | `manifest.styles[]`, CSS inlined into the viewer page's customStyles.                                   |
| [scripts-demo](./scripts-demo/)                   | `manifest.scripts[]`, JS inlined into the viewer page's customJavascript.                               |
| [page-content-demo](./page-content-demo/)         | `manifest.extraPageContent` + tabs rendered server-side from Mustache templates.                        |
| [theme-hub](./theme-hub/)                         | Dynamic `@plugin.on_page_styles` + `@plugin.on_page_scripts`: an admin-selectable theme catalog applied to the whole viewer UI via `customStyles`. |
| [viewer-gate](./viewer-gate/)                     | `manifest.styles` + `manifest.scripts` together: a confirmation modal on page load.                     |
| [tabs-demo](./tabs-demo/)                         | `manifest.tabs[]`, two tabs added to the viewer page's tab row alongside Followers and About.           |
| [timer-bot](./timer-bot/)                         | `owncast.timer` (set_timeout/set_interval/clear) and the once-a-second `on_tick` event.                 |
| [whoami](./whoami/)                               | Reads the logged-in chat user the host passes to a plugin HTTP handler as `req.user`.                   |

## Building and testing

Install the SDK to get the `owncast-plugin-py` CLI (see [`sdks/python`](../../sdks/python/) for details). It fetches and caches the wasm toolchain on first use, so there's nothing else to install by hand:

```sh
uv tool install owncast-plugin-py      # or:  pip install owncast-plugin-py
```

Then, per example:

```sh
owncast-plugin-py build   examples/python/<name>    # compile src/plugin.py -> <slug>.wasm
owncast-plugin-py test    examples/python/<name>    # run the __tests__/ scenarios
owncast-plugin-py serve   examples/python/<name>    # local dev server (POST /_dev/chat to drive it)
owncast-plugin-py package examples/python/<name>    # build + bundle -> <slug>.ocpkg (the file you ship)
```

A Python plugin's source lives in `src/plugin.py`. `extism-py` compiles a single file, so the build inlines the SDK runtime and your code into one module before compiling. You still `from owncast_plugin import …` for editor support and unit tests.
