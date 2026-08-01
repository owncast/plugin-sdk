---
name: create-owncast-plugin-py
description: "Build a complete Owncast plugin in Python from a plain-language description and hand back an installable .ocpkg file. Use when someone wants to create, build, scaffold, or make an Owncast plugin in Python (a chat bot, chat filter/moderation tool, stream-event responder, HTTP page/overlay/widget, admin page, fediverse integration, etc.) without needing to know the SDK internals. If the author hasn't picked a language yet, start from create-owncast-plugin (the router) instead."
---

# Create an Owncast plugin (Python)

This skill walks any AI assistant through building a working Owncast plugin in
**Python** for a non-expert user: gather what they want in plain language,
scaffold the project, write the code and manifest, verify it with tests, and
produce the single `.ocpkg` file they upload to their Owncast server. The user
should never have to understand the runtime. You do that part.

> **Picking a language?** Owncast plugins can be written in JavaScript or Python.
> The two SDKs are first-class peers: the same handlers, APIs, permissions, and
> manifest apply to both, and only the scaffolding and language syntax differ.
> This skill is the **Python** path. For JavaScript, use `create-owncast-plugin-js`.
> If the language isn't decided yet, start from the `create-owncast-plugin`
> router, which gathers the author's intent and dispatches to the right one.

This file is the complete operating guide. It is written to be tool-agnostic:
wherever it says "ask the user," use whatever question mechanism your harness
offers (a structured prompt UI, or just a plain chat question). Wherever it says
"run," use your shell/command tool.

## What an Owncast plugin is (one paragraph)

A plugin is Python that runs sandboxed inside the Owncast server. It subscribes
to events (chat messages, stream start/stop, fediverse activity) by registering
handler functions with `@plugin.*` decorators, and calls back into Owncast
through the `owncast.*` API (send chat, store data, fetch URLs, serve web pages,
etc.). A `plugin.manifest.json` declares the plugin's identity and the
**permissions** it needs. Every API call requires its matching permission, or
the host refuses to load the plugin. The build step just emits the Python source
as `<slug>.py` and bundles it with the manifest and assets into one `.ocpkg` file
for distribution.

> Plugins ship as source, not a compiled binary. The Owncast host embeds one
> Python engine and runs every Python plugin on it, so a package carries no
> interpreter and an author never touches a wasm toolchain.

## The workflow (follow in order)

### Step 1: Understand what they want

Ask the user, in plain language:

1. **What should the plugin be called?** (e.g. "Welcome Bot"). Derive a **slug**
   from it: lowercase, digits and hyphens only, must start with a letter, max 64
   chars (e.g. `welcome-bot`). If their name can't map to a valid slug, propose
   one and confirm.
2. **What should it do?** Get concrete behavior, not a category. "Greet people
   when they join," "delete messages containing a word," "show a live chat
   overlay on a web page," "post to Discord when the stream goes live."

Then map their description to capabilities using the **Capability map** below.
That tells you which handler(s) to write, which `owncast.*` calls to make, and
which permissions the manifest must declare. If a request needs a high-trust
permission (`fediverse.post`, `videoconfig.write`, `users.moderate`,
`network.fetch` to arbitrary hosts, or `auth.gate`, which lets the host require
the plugin's login for operator-selected viewer resources), note it back to the
user. The server admin will have to approve it.

Keep it small. Build the simplest plugin that does what they asked. You can
always add handlers later.

### Step 2: Make sure you have a plugin project

**If your working directory already contains a `plugin.manifest.json`**, you are
already inside a scaffolded plugin (this skill may have shipped inside it). Do
**not** scaffold again. Skip to Step 3 and edit the project in place, using its
existing slug.

**Otherwise, scaffold a new project** with the official scaffolder
(non-interactive, takes the slug as an argument):

```sh
owncast-plugin-py new <slug>
# or, without installing the SDK first:
uvx owncast-plugin-py new <slug>
```

This creates a `<slug>/` directory with `plugin.manifest.json`,
`src/plugin.py`, and `__tests__/plugin.test.json` already wired up. All
subsequent commands run **from inside that directory**.

### Step 3: Write the plugin

Edit two files based on what you learned in Step 1:

- **`src/plugin.py`**: register only the handlers the behavior needs. See
  **Writing handlers** and the **Capability map**.
- **`plugin.manifest.json`**: set `name`, `description`, and the exact
  `permissions` required by the handlers you register and APIs you call. See **The manifest**.

If the plugin serves web content, add files under `public/` (web-served) or
`assets/` (host-read for inlined UI). Replace the scaffolded test in
`__tests__/plugin.test.json` with scenarios that assert your actual behavior
(see **Testing**).

**Clear the scaffolded placeholders.** They ship verbatim, so don't leave the
defaults:

- Set a real `description` in `plugin.manifest.json` (the scaffold leaves `"An
  Owncast plugin"`).
- **Fill in `INSTRUCTIONS.md`.** It's bundled into the `.ocpkg` and rendered as
  an **Instructions** tab on the plugin's page in the Owncast admin. Its only
  audience is the **person installing and running the plugin** (the Owncast
  admin / streamer), not you the developer. Write it for them, in plain
  language: **what the plugin does and how to use it once enabled**, including any
  settings to configure and what each does, the features it adds and how to use
  them (e.g. chat commands like `!hello`, what happens automatically), and where
  any page, button, or tab it adds shows up. You built the plugin, so describe
  its real behavior concretely and accurately. Always write this to the best of
  your ability. Don't ship the "Write anything an Owncast admin should know…"
  placeholder and don't leave it empty.

### Step 4: Test

```sh
owncast-plugin-py test
```

The first run downloads and caches the host test/serve binaries (there's no wasm
toolchain: plugins run on the engine the host embeds). `test` emits
`src/plugin.py` as `<slug>.py` and runs `__tests__/*.test.json` against the real
plugin runtime with mocked side effects, so a pass means the same behavior in
production.

**When the build or tests fail, first classify the failure. They need opposite
responses:**

- **A behavior/assertion failure** (the test ran and the output didn't match, a
  Python error in your handler, a missing permission for an API you call). This
  is yours to fix: read the diff, correct `src/plugin.py`, the manifest, or the
  expectation, and re-run. Don't package with these unresolved.
- **A toolchain/version-skew failure**, with host/runtime mismatch errors that fire
  **before your test logic runs** (e.g. an import or host-function name the
  runtime doesn't recognize). This is **not** a bug in your plugin, so don't edit
  handlers to chase it. It means the installed SDK runtime and its bundled
  test-host binary are out of sync. Respond by: (1) ensuring the latest version with
  `uv tool upgrade owncast-plugin-py` (or `pip install -U owncast-plugin-py`) and re-run. (2) If
  it persists, note that the compiled `.ocpkg` is still valid for a current
  Owncast server (the skew is only in the local test harness), proceed to **Step
  5**, and tell the user tests couldn't run locally due to a toolchain version
  mismatch. Do not loop on it.

(If the toolchain can't be fetched because there's no network, tell the user
that's required once, and continue to write correct code so they can run
`owncast-plugin-py test && owncast-plugin-py package` themselves.)

### Step 5: Package and hand off

```sh
owncast-plugin-py package
```

`package` first load-checks the plugin — the same install-time path a real
Owncast server runs. A handler whose gating permission isn't declared in the
manifest (a chat filter without `chat.filter`, a fediverse handler without
`fediverse.inbound`) aborts packaging with the exact error the server would
give at install. Fix the manifest, don't work around the check.

This produces **`<slug>.ocpkg`** in the project directory, a single
self-contained file bundling the manifest, the `plugin.py` source, and any
`public/`/`assets/`/`icon.png`/`INSTRUCTIONS.md`. Give the user the path to that
file and tell them how to install it:

> Open **Plugins** in your Owncast admin → **Upload plugin** → select
> `<slug>.ocpkg`. Then review the **Permissions** tab and toggle **Enabled**.
> (Alternatively, drop the file into `data/plugins/` on the server.)

Briefly summarize what the plugin does and which permissions the admin will be
asked to approve, and why each is needed.

---

## Capability map (intent → handler + API + permission)

Match the user's described behavior to these rows. Register the listed
handler(s), call the listed API, and add the listed permission to the manifest.
Several rows combine for richer plugins.

| They want to…                                   | Handler(s)                                          | API call                                       | Permission(s)                          |
| ----------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- | -------------------------------------- |
| React to chat messages                          | `@plugin.on_chat_message`                           | —                                              | — (add `chat.send` to reply)           |
| Reply / post in chat                            | (any handler)                                       | `owncast.chat.send(text)` / `.send_action`     | `chat.send`                            |
| Whisper privately to a sender                   | `on_chat_message` / `filter_chat_message`           | `owncast.chat.reply_to(msg, text)`             | `chat.send`                            |
| Run chat commands (`!uptime`, etc.)             | `plugin.commands({...})`                             | `ctx.reply` / `ctx.reply_privately`            | `chat.send` to reply                  |
| Inspect/modify/drop every message (moderation)  | `@plugin.filter_chat_message`                       | `filter.pass_/modify/drop`                     | `chat.filter` (required for the handler) |
| Delete a message / kick a client                | (any)                                               | `owncast.chat.delete_message` / `.kick`        | `chat.moderate`                        |
| Read recent chat / list clients                 | (any)                                               | `owncast.chat.history()` / `.clients()`        | `chat.history`                         |
| React when stream goes live / stops             | `@plugin.on_stream_started` / `_stopped`            | —                                              | —                                      |
| Read live stream state (title, viewers, uptime) | (any)                                               | `owncast.stream.current()`                     | `server.read`                          |
| Read server info / socials / emotes / tags      | (any)                                               | `owncast.server.*()`                           | `server.read`                          |
| Store per-user or persistent state              | (any)                                               | `owncast.kv.get/set` (+ `get_json/set_json`)   | `storage.kv`                           |
| Rank or aggregate data (private SQL database)   | (any)                                               | `owncast.sql.exec/query/query_row`             | `storage.sql`                          |
| Expose admin-configurable settings              | (read at runtime)                                   | `owncast.config.get(key, fallback=None)`       | — (declare under `config` in manifest) |
| Call an external API / webhook                  | (any)                                               | `owncast.http.fetch(url, opts=None)`           | `network.fetch` + `network.allowedHosts` |
| Do delayed / periodic work                      | `@plugin.on_tick` or `owncast.timer.*`              | `owncast.timer.set_timeout/set_interval`       | — (ambient)                            |
| Serve a web page / overlay / JSON endpoint      | `@plugin.get/post/...` / `on_http_request` + `public/` | return `{status, headers, body}`            | `http.serve`                           |
| Push realtime updates to a browser              | (any)                                               | `owncast.sse.send(channel, event, data)`       | `http.sse`                             |
| Add an admin settings page in the Owncast UI    | `@plugin.on_http_request` + `public/admin/...`      | —                                              | `http.serve` + `admin.pages` manifest  |
| Add a button under the viewer's stream          | (manifest only, or `owncast.actions.add`)           | —                                              | `ui.modify` (+ `http.serve` if it opens your page) |
| Inject CSS / JS / HTML into the viewer page     | (manifest `styles`/`scripts`/`extraPageContent`)    | dynamic `@plugin.on_page_styles` / `on_page_scripts` / `on_page_content` | `ui.modify`                            |
| Add a tab to the viewer page                    | optional `@plugin.on_tab_content`                   | —                                              | `ui.modify` (+ data perms used)        |
| Upload a file and get a public URL              | (any)                                               | `owncast.storage.upload(name, bytes)`          | `storage.upload`                       |
| Private server-side files                       | (any)                                               | `owncast.fs.*`                                 | `storage.fs`                           |
| Send Discord / browser-push / fediverse notice  | (any)                                               | `owncast.notifications.*`                      | `notifications.send`                   |
| Post publicly to the fediverse (high-trust)     | (any)                                               | `owncast.fediverse.post(text)`                 | `fediverse.post`                       |
| React to any verified inbound fediverse activity | `@plugin.on_fediverse` gets a non-subscriptable `_Obj` attribute view. Use `payload.raw` for the underlying dictionary and keys like `@context`. Specialized handlers: `@plugin.on_fediverse_follow/like/repost/quote/mention/reply` | none | `fediverse.inbound` |
| Read/change video/transcoding config            | (any)                                               | `owncast.video_config.read/write`              | `videoconfig.read` / `videoconfig.write` |
| Compose with other plugins via custom events    | emit: `owncast.events.emit`, receive: `@plugin.on(...)` | `owncast.events.emit(type, payload)`       | `events.emit` (emitter only)           |
| Gate the site behind a member login (paywall) | `@plugin.on_http_request` (login flow) + `@plugin.on_auth_check` (re-validation) | `owncast.users.register` + `owncast.auth.grant_session/end_session` | `auth.gate` + `users.register` (+ `http.serve`); model on `examples/python/github-auth` |

**Golden rule:** the `permissions` array must contain exactly the permissions
required by the handlers you register and every `owncast.*` method you call.
Missing one means the call throws and/or the host refuses to load the plugin.
Don't add permissions you don't use, since admins judge trust by the declared list.

---

## Writing handlers

```python
from owncast_plugin import plugin, owncast, filter


@plugin.on_chat_message
def greet(msg):
    # msg has attributes: id, user, client_id, body, timestamp. msg.user is a
    # User (msg.user.id, .display_name, .display_color, .scopes) in production, or None for
    # a message with no associated account. Read the name defensively.
    name = msg.user.display_name if msg.user else "there"
    words = msg.body.split()
    if words and words[0].lower() == "hi":
        owncast.chat.send(f"hello, {name}!")
```

Register **only** the handlers you need. The SDK derives event subscriptions
from which handlers exist. Decorators: `@plugin.on_chat_message`,
`@plugin.filter_chat_message`, `@plugin.on_chat_user_joined` / `_parted` /
`_renamed`, `@plugin.on_message_moderated`, `@plugin.on_stream_started` /
`_stopped` / `_title_changed`, `@plugin.on_fediverse`,
`@plugin.on_fediverse_follow` / `_like` / `_repost` / `_quote` / `_mention` / `_reply`, `@plugin.on_tick`, `@plugin.on_sse_connect` /
`_disconnect`, `@plugin.on_tab_content("slug")`, `@plugin.on_page_content("slug")`,
`@plugin.on_page_styles`, `@plugin.on_page_scripts`,
HTTP routes (`@plugin.get/post/put/delete/patch(path)`, `@plugin.route`,
`@plugin.on_http_request`), and `@plugin.on("namespace.event")` for custom events.

Important shape/behavior notes:

- **`msg.user` is an attribute object or `None`.** Production sends a User
  (`msg.user.id`, `msg.user.display_name`, `msg.user.display_color`, `msg.user.scopes`). A message with no
  account is `None`. Read the name defensively: `msg.user.display_name if
  msg.user else "..."`. For stable per-user state and moderator gating use
  `msg.user.id` and `msg.user.scopes`, never the display name. Use
  `msg.raw` for the underlying dict. Declarative command tables handle
  moderator gating automatically.
- **Chat text is HTML-escaped on display.** `chat.send`/`send_action` take plain
  text. The exception is `chat.system(body)`, whose body renders as HTML, so escape
  untrusted content yourself.
- **Filters fail open and are time-capped (50 ms).** `filter_chat_message` must
  be fast. A filter that errors is treated as `filter.pass_()`. Five consecutive
  failures auto-disable the plugin for the session.
- **`filter.pass_()` has a trailing underscore** (`pass` is a Python keyword).
- **No `time.sleep` / threads for delays.** Use `owncast.timer.*`. Timers don't
  survive a host restart.
- **`owncast.sql.*` is one private SQLite database per plugin.** Each `exec` is
  a single atomic transaction, so a multi-statement schema setup either lands
  whole or not at all. An unbounded `query` that overruns the host's row or
  result budget is an error, not a truncated result, so write a `LIMIT`, or use
  `query_row` when you only need one row. Plugin databases are not included in
  Owncast's backups. Worked example: `examples/python/chat-leaderboard`.
- **Chat commands:** declare commands with `plugin.commands({...})`. Command
  tables support prefixes, aliases, parsed arguments, moderator gating, and
  per-user cooldowns. Unknown and gated invocations are silent.

## The manifest

```json
{
  "api": "1",
  "name": "Welcome Bot",
  "slug": "welcome-bot",
  "version": "0.1.0",
  "description": "Greets people when they join the chat",
  "permissions": ["chat.send"]
}
```

- `name`: human-readable, and also the default chat-bot display name. `bot.displayName` overrides it.
- `slug`: canonical id (URL prefix, storage namespace, filename). Auto-derived from `name` if omitted, but keep it explicit and matching the directory.
- `permissions`: see the Capability map. Declare exactly what you use.
- `config`: optional admin-configurable settings: `{ "key": { "type": "string|number|boolean", "default": ..., "description": "..." } }`, read via `owncast.config.get`.
- UI fields (`actions`, `styles`, `scripts`, `extraPageContent`, `tabs`) all require `ui.modify`.
- `tabs`: `{ "tab-slug": { "title": "Tab label", "content": "optional.html" } }`.
- `admin.pages`: `{ "/admin/*": { "title": "Settings" } }`. The host auth-gates matching path keys.
- **`network.fetch` also requires `network` block:** `"network": { "allowedHosts": ["api.example.com", "*.weather.com"] }`. The bare wildcard `"*"` is allowed but must be written explicitly. The host rejects the load if `network.fetch` is granted without `allowedHosts`.

## Project layout

```
<slug>/
├── plugin.manifest.json   # identity + permissions
├── icon.png               # optional: admin-list icon (bundled automatically)
├── INSTRUCTIONS.md        # optional: rendered as an admin tab
├── src/plugin.py          # your code
├── public/                # optional: served at /plugins/<slug>/...
├── assets/                # optional: host-read for inlined styles/scripts/HTML (NOT URL-served)
└── __tests__/*.test.json  # scenario tests
```

## Testing

Replace the scaffolded test with scenarios for your behavior. Each scenario is
JSON: it dispatches events and asserts on observed side effects. The format is
identical to the JS SDK's and runs through the same `owncast-plugin-test` binary.

```json
[
  {
    "name": "greets joining users",
    "events": [{ "event": "chat.user.joined", "payload": { "id": "u1", "displayName": "alice" } }],
    "expect": { "chatSends": ["welcome, alice!"] }
  }
]
```

Step types: `event`, `filter` (with `expect: {action, payload?, reason?}`),
`http` (`{method, path, expect:{status, bodyContains?}}`), `tabContent`,
`pageContent`, `pageStyles`, `pageScripts`, and `authCheck` (drives
`on_auth_check` for `auth.gate` plugins). Final-state assertions include `chatSends`, `chatActions`,
`chatSystems`, `chatTo`, `sseSends`, `emits`, `kv`, `httpRequests`,
`videoConfigWrites`. Seed inputs with `given` (`given.kv`, `given.config`,
`given.stream`, `given.users`, `given.httpResponses`, etc.). Use `authenticated: true` or a
`user` object on `http` steps to test admin/user-gated endpoints.

Shapes that trip people up:

- **A chat event's `user` is an object** (`{ "id", "displayName", "scopes"? }`)
  in production. The test payload should match what your handler reads. If the
  handler reads `msg.user.id` / `.scopes` / `.display_name`, pass an object
  (`"user": { "id": "u1", "displayName": "alice" }`). A payload with no `user`
  arrives as `msg.user is None`.
- **`config` values come from the manifest defaults** unless the scenario seeds
  admin overrides via `given.config` (`"given": { "config": { "key": "value" } }`).
  `owncast.config.get("key")` returns the override when seeded, otherwise the
  `default` declared under `config` in `plugin.manifest.json`. Test both paths.
- **One `given.httpResponses` entry per URL pattern.** The `url` is a glob
  matched against the full URL (`"https://api.example.com/user*"` covers any
  query string) and the first match wins, so a sequence where the same URL must
  answer differently across calls can't be modeled by fixtures.

For interactive iteration, `owncast-plugin-py serve` hosts the plugin on
`http://localhost:8080/plugins/<slug>/` with `/_dev/*` endpoints to fire events.

## Common recipes (copy and adapt)

**Greeter** (`permissions: ["chat.send"]`):
```python
@plugin.on_chat_user_joined
def welcome(user):
    owncast.chat.send(f"welcome, {user.display_name}!")
```

**Word filter** (`permissions: ["chat.filter"]`):
```python
@plugin.filter_chat_message
def block(msg):
    return filter.drop("blocked") if "badword" in msg.body.lower() else filter.pass_()
```

**External fetch on command** (`permissions: ["chat.send","network.fetch"]`, `network.allowedHosts: ["api.ipify.org"]`):
```python
@plugin.on_chat_message
def ip(msg):
    if msg.body.strip() != "!ip":
        return
    res = owncast.http.fetch("https://api.ipify.org?format=json")
    if res.status == 200:
        owncast.chat.send(f"IP: {json.loads(res.body)['ip']}")
```

**Notify Discord on stream start** (`permissions: ["notifications.send"]`):
```python
@plugin.on_stream_started
def live(info):
    owncast.notifications.discord(f"Live now: {info.title or 'stream'}")
```

## Where to go deeper

The repository's `docs/PLUGIN_AUTHOR_GUIDE.md` is the exhaustive reference (every
handler, every API method, limits, SSE, admin pages, action buttons, viewer-page
injection, full testing model). Read the camelCase API names there as their
Pythonic `snake_case` forms. Worked Python examples live in `examples/python/`.

The public documentation at <https://owncast.online/docs/plugins> covers the same
ground for authors who want a web reference: the
[Python SDK](https://owncast.online/docs/plugins/sdks/python),
[Manifest](https://owncast.online/docs/plugins/manifest),
[Events](https://owncast.online/docs/plugins/events),
[Owncast APIs](https://owncast.online/docs/plugins/apis),
[Permissions](https://owncast.online/docs/plugins/permissions),
[Testing](https://owncast.online/docs/plugins/testing), and
[Packaging](https://owncast.online/docs/plugins/packaging) pages.

## Checklist before you hand off the .ocpkg

- [ ] `name`, `slug`, real `description` set (not the `"An Owncast plugin"` placeholder), and slug valid and matches the directory.
- [ ] `permissions` lists exactly the APIs the code calls, no more and no less.
- [ ] `network.allowedHosts` present if `network.fetch` is used, `ui.modify` present for any UI field, and `chat.filter` present if `filter_chat_message` is defined.
- [ ] `INSTRUCTIONS.md` is written for the person installing/running the plugin (what it does and how to use it once enabled), not the scaffold placeholder, and it ships in the `.ocpkg`.
- [ ] `owncast-plugin-py test` passes, or, if it failed only on a toolchain/version skew (not your logic), you confirmed that and said so.
- [ ] `owncast-plugin-py package` produced `<slug>.ocpkg`, you gave the user its path and install instructions, and noted which permissions the admin must approve.
