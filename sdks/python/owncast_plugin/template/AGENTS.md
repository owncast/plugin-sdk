# AGENTS.md: __PLUGIN_DISPLAY_NAME__

Guidance for AI coding agents working on this Owncast plugin (slug:
`__PLUGIN_SLUG__`). It encodes the SDK's rules so you can add behavior correctly
without re-deriving how the runtime works. Tool-agnostic: "run" means use your
shell tool. Follow these steps with whatever model/harness you are.

> **Skill available.** This plugin ships the `create-owncast-plugin-py` skill at
> `.agents/skills/create-owncast-plugin-py/SKILL.md`. Skill-aware agents discover it
> automatically, otherwise read that file. It drives the full build-this-plugin
> workflow (turn a plain-language request into handlers + manifest, then test and
> package). This AGENTS.md is the quick reference, and the skill is the playbook.

## What this project is

An Owncast plugin: **Python** that runs sandboxed inside the Owncast server. It
subscribes to events by registering handler functions in `src/plugin.py` with
`@plugin.*` decorators, and calls back into Owncast through the `owncast.*` API.
`plugin.manifest.json` declares the plugin's identity and the **permissions** it
needs. Plugins ship as source and run on the Python engine the host embeds, so
`package` just bundles your source, the manifest, and assets into one
`__PLUGIN_SLUG__.ocpkg` file for distribution.

## Files you edit

- `src/plugin.py`: handler code. Register **only** the handlers you need. The
  SDK derives event subscriptions from which handlers exist.
- `plugin.manifest.json`: `name`, `slug`, `version`, `description`,
  `permissions`, optional `bot.displayName`, `config`, and UI fields.
- `__tests__/plugin.test.json`: scenario tests (JSON). Update them to assert your real behavior.
- `public/` (create if needed): files served at `/plugins/__PLUGIN_SLUG__/...`.
- `assets/` (create if needed): host-read for inlined UI (`styles`/`scripts`/
  `extraPageContent`), but **not** reachable via URL.

## Workflow

```sh
owncast-plugin-py test         # builds, then runs __tests__/*.test.json against the real runtime
owncast-plugin-py package      # builds, then bundles __PLUGIN_SLUG__.ocpkg for distribution
owncast-plugin-py serve        # optional: host on http://localhost:8080 for manual testing
```

The first run downloads and caches the host test/serve binaries (there's no wasm
toolchain: plugins run on the engine the host embeds). Always run
`owncast-plugin-py test` after changing code, and don't package with failing
tests. Fix the code or correct the expectation (and say which).

## The golden rule

**The `permissions` array must contain exactly the permissions required by the
handlers you register and every `owncast.*` method you call**, no more and no
less. A missing permission makes the call throw and/or the host refuse to load
the plugin. Admins judge trust by the declared list, so don't over-declare.

## Capability map (intent → handler + API + permission)

| To…                                            | Handler(s)                                          | API call                                       | Permission(s)                          |
| ----------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- | -------------------------------------- |
| React to chat messages                          | `@plugin.on_chat_message`                           | —                                              | — (`chat.send` to reply)               |
| Reply / post in chat                            | (any)                                               | `owncast.chat.send(text)` / `.send_action`     | `chat.send`                            |
| Whisper privately to a sender                   | `on_chat_message` / `filter_chat_message`           | `owncast.chat.reply_to(msg, text)`             | `chat.send`                            |
| Run chat commands (`!cmd`)                      | `plugin.commands({...})`                             | `ctx.reply` / `ctx.reply_privately`            | `chat.send` to reply                  |
| Inspect/modify/drop every message (moderate)    | `@plugin.filter_chat_message`                       | `filter.pass_/modify/drop`                     | `chat.filter` (required for handler)   |
| Delete a message / kick a client                | (any)                                               | `owncast.chat.delete_message` / `.kick`        | `chat.moderate`                        |
| Read recent chat / list clients                 | (any)                                               | `owncast.chat.history()` / `.clients()`        | `chat.history`                         |
| React to stream live / stop                     | `@plugin.on_stream_started` / `_stopped`            | —                                              | —                                      |
| Read live stream / server state                 | (any)                                               | `owncast.stream.current()` / `server.*()`      | `server.read`                          |
| Store state                                     | (any)                                               | `owncast.kv.get/set` (+ `get_json/set_json`)   | `storage.kv`                           |
| Rank or aggregate data (private SQL database)   | (any)                                               | `owncast.sql.exec/query/query_row`             | `storage.sql`                          |
| Admin-configurable settings                     | (read at runtime)                                   | `owncast.config.get(key, fallback=None)`       | — (declare under `config`)             |
| Call an external API                            | (any)                                               | `owncast.http.fetch(url, opts=None)`           | `network.fetch` + `network.allowedHosts` |
| Delayed / periodic work                         | `@plugin.on_tick` / `owncast.timer.*`               | `owncast.timer.set_timeout/set_interval`       | — (ambient)                            |
| Serve a web page / JSON endpoint / overlay      | `@plugin.get/post/...` / `on_http_request` + `public/` | return `{status, headers, body}`            | `http.serve`                           |
| Push realtime updates to a browser              | (any)                                               | `owncast.sse.send(channel, event, data)`       | `http.sse`                             |
| Admin settings page in the Owncast UI           | `@plugin.on_http_request` + `public/admin/...`      | —                                              | `http.serve` + `admin.pages`           |
| Button under the viewer's stream                | manifest `actions` / `owncast.actions.add`          | —                                              | `ui.modify` (+ `http.serve` if it opens your page) |
| Inject CSS / JS / HTML into the viewer page     | manifest `styles`/`scripts`/`extraPageContent`      | dynamic: `@plugin.on_page_styles` / `on_page_scripts` / `on_page_content` | `ui.modify`                            |
| Add a tab to the viewer page                    | optional `@plugin.on_tab_content`                   | —                                              | `ui.modify` (+ data perms used)        |
| Upload a file, get a public URL                 | (any)                                               | `owncast.storage.upload(name, bytes)`          | `storage.upload`                       |
| Private server-side files                       | (any)                                               | `owncast.fs.*`                                 | `storage.fs`                           |
| Discord / push / fediverse notification         | (any)                                               | `owncast.notifications.*`                      | `notifications.send`                   |
| Post publicly to the fediverse (high-trust)     | (any)                                               | `owncast.fediverse.post(text)`                 | `fediverse.post`                       |
| React to any verified inbound fediverse activity | `@plugin.on_fediverse` gets a non-subscriptable `_Obj` attribute view. Use `payload.raw` for the underlying dictionary and keys like `@context`. Specialized handlers: `@plugin.on_fediverse_follow/like/repost/quote/mention/reply` | none | `fediverse.inbound` |
| Read/change video config                        | (any)                                               | `owncast.video_config.read/write`              | `videoconfig.read` / `videoconfig.write` |
| Compose with other plugins                      | emit `owncast.events.emit`, receive `@plugin.on(...)` | `owncast.events.emit(suffix, payload)`, delivered as `<your-slug>.<suffix>` | `events.emit` (emitter only)           |
| Gate the site behind a member login (paywall) | `@plugin.on_http_request` (login flow) + `@plugin.on_auth_check` (re-validation) | `owncast.users.register` + `owncast.auth.grant_session/end_session` | `auth.gate` + `users.register` (+ `http.serve`) |

## Gotchas that bite

- **`msg.user` is an attribute object, or `None`.** Production sends a User
  (`msg.user.id`, `msg.user.display_name`, `msg.user.display_color`, `msg.user.scopes`). A message with no
  associated account has `msg.user is None`. Guard it: `msg.user.display_name if
  msg.user else "someone"`. For per-user state and mod gating use `msg.user.id`
  and `msg.user.scopes`, never the display name. Use `msg.raw` for the underlying dict.
- **Chat text is HTML-escaped on display.** `chat.send`/`send_action` take plain
  text. Only `chat.system(body)` renders HTML, so escape untrusted content yourself.
- **Filters are time-capped (50 ms) and fail open.** Keep `filter_chat_message`
  fast. An erroring filter is treated as `filter.pass_()`. Five consecutive
  failures auto-disable the plugin for the session.
- **`filter.pass_()` has a trailing underscore** because `pass` is a Python keyword.
- **No `time.sleep` / threads for delays.** Use `owncast.timer.*` (timers don't
  survive a host restart).
- **`owncast.sql.*` is one private SQLite database per plugin.** Each `exec` is a
  single atomic transaction, so a multi-statement schema setup lands whole or not
  at all. An unbounded `query` that overruns the host's row or result budget is
  an error, not a truncated result: write a `LIMIT`, or use `query_row` for a
  single row. Plugin databases are not included in Owncast's backups. The SDK's
  `examples/python/chat-leaderboard` is a worked example.
- **`network.fetch` requires `network.allowedHosts`** in the manifest, e.g.
  `"network": { "allowedHosts": ["api.example.com"] }`. The bare `"*"` is allowed
  but must be explicit.
- **Any UI field** (`actions`, `styles`, `scripts`, `extraPageContent`, `tabs`)
  **requires `ui.modify`**.
- **Pure-Python only.** Dependencies with C extensions (numpy, pandas, …) won't
  load on the embedded engine. Don't shadow stdlib names (e.g. a top-level
  `def json(...)`): your code runs in the same global scope as the runtime.
- **Declare chat commands with `plugin.commands({...})`.** Command tables support
  aliases, moderator gating, and per-user cooldowns. Unknown and gated
  invocations are silent.
- **Config in tests:** `owncast.config.get` returns manifest defaults unless the
  scenario seeds admin overrides via `given.config`
  (`"given": { "config": { "key": "value" } }`). Test both the override and the
  default/unconfigured path.
- **One `given.httpResponses` entry per URL pattern.** The `url` is a glob on the
  full URL and the first match wins, so same-URL sequences (401, then 200 after a
  refresh) can't be modeled by fixtures.

## Testing

`__tests__/*.test.json` scenario files dispatch events and assert on observed
side effects. The format is identical to the JS SDK's and runs through the same
`owncast-plugin-test` binary:

```json
[
  {
    "name": "...",
    "events": [{ "event": "chat.message.received", "payload": { "id": "1", "user": { "id": "u1", "displayName": "alice" }, "body": "hi", "timestamp": "2024-01-01T00:00:00Z" } }],
    "expect": { "chatSends": ["..."] }
  }
]
```

Final-state assertions: `chatSends`, `chatActions`, `chatSystems`, `chatTo`,
`sseSends`, `emits`, `kv`, `httpRequests`, `videoConfigWrites`. Seed inputs with
`given` (`given.kv`, `given.config`, `given.stream`, `given.users`,
`given.httpResponses`, …).
Step types: `event`, `filter`, `http`, `tabContent`, `pageContent`,
`pageStyles`, `pageScripts`, `authCheck` (drives `on_auth_check` for
`auth.gate` plugins).

## Full reference

The exhaustive author guide, covering every handler, API method, limit, and
testing pattern, lives at:

**https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md**

Read the camelCase API names there as their Pythonic `snake_case` forms
(`sendAction` → `send_action`, `getJSON` → `get_json`, etc.). Worked Python
examples live in `examples/python/`.
