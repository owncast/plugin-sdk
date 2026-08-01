---
name: create-owncast-plugin-js
description: "Build a complete Owncast plugin in JavaScript from a plain-language description and hand back an installable .ocpkg file. Use when someone wants to create, build, scaffold, or make an Owncast plugin in JavaScript/Node (a chat bot, chat filter/moderation tool, stream-event responder, HTTP page/overlay/widget, admin page, fediverse integration, etc.) without needing to know the SDK internals. If the author hasn't picked a language yet, start from create-owncast-plugin (the router) instead."
---

# Create an Owncast plugin (JavaScript)

This skill walks any AI assistant through building a working Owncast plugin in
**JavaScript** for a non-expert user: gather what they want in plain language,
scaffold the project, write the code and manifest, verify it with tests, and
produce the single `.ocpkg` file they upload to their Owncast server. The user
should never have to understand the runtime. You do that part.

> **Picking a language?** Owncast plugins can be written in JavaScript or Python.
> The two SDKs are first-class peers: the same handlers, APIs, permissions, and
> manifest apply to both, and only the scaffolding and language syntax differ.
> This skill is the **JavaScript** path. For Python, use `create-owncast-plugin-py`.
> If the language isn't decided yet, start from the `create-owncast-plugin`
> router, which gathers the author's intent and dispatches to the right one.

This file is the complete operating guide. It is written to be tool-agnostic:
wherever it says "ask the user," use whatever question mechanism your harness
offers (a structured prompt UI, or just a plain chat question). Wherever it says
"run," use your shell/command tool.

## What an Owncast plugin is (one paragraph)

A plugin is JavaScript that runs sandboxed inside the Owncast server. It
subscribes to events (chat messages, stream start/stop, fediverse activity) by
defining handler functions, and calls back into Owncast through the `owncast.*`
API (send chat, store data, fetch URLs, serve web pages, etc.). A
`plugin.manifest.json` declares the plugin's identity and the **permissions** it
needs. Every API call requires its matching permission, or the host refuses to
load the plugin. Plugins ship as source and run on the JavaScript engine the
Owncast host embeds (no wasm compile step). `npm run package` bundles everything
into one `.ocpkg` file for distribution.

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
npx create-owncast-plugin@latest <slug>
```

This creates a `<slug>/` directory with `package.json`, `plugin.manifest.json`,
`src/plugin.js`, and `__tests__/plugin.test.js` already wired up. All subsequent
commands run **from inside that directory**.

### Step 3: Write the plugin

Edit two files based on what you learned in Step 1:

- **`src/plugin.js`**: define only the handlers the behavior needs. See
  **Writing handlers** and the **Capability map**.
- **`plugin.manifest.json`**: set `name`, `description`, and the exact
  `permissions` required by the handlers you register and APIs you call. See **The manifest**.

If the plugin serves web content, add files under `public/` (web-served) or
`assets/` (host-read for inlined UI). Replace the scaffolded test in
`__tests__/plugin.test.js` with scenarios that assert your actual behavior (see
**Testing**).

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

### Step 4: Install, then test

```sh
npm install      # one-time, fetches the prebuilt test/serve host binaries
npm test         # builds the plugin, then runs your scenario tests
```

`npm test` bundles `src/plugin.js` into `<slug>.js` and runs `__tests__/*.test.js`
against the real plugin runtime with mocked side effects. A pass means the same
behavior in production.

**When the build or tests fail, first classify the failure. They need opposite
responses:**

- **A behavior/assertion failure** (the test ran and the output didn't match, a
  JS error in your handler, a missing permission for an API you call). This is
  yours to fix: read the diff, correct `src/plugin.js`, the manifest, or the
  expectation, and re-run. Don't package with these unresolved.
- **A toolchain/version-skew failure**, with messages like `"owncast_<something>" is
  not exported in module "extism:host/user"`, or other host/runtime mismatch
  errors that fire **before your test logic runs**. This is **not** a bug in your
  plugin, so don't edit handlers to chase it. It means the installed
  `@owncast/plugin-sdk` runtime and its bundled test-host binary are out of sync.
  Respond by: (1) ensuring the latest versions with
  `npm install @owncast/plugin-sdk@latest` and re-run. (2) If it persists, note
  that the compiled `.ocpkg` is still valid for a current Owncast server (the
  skew is only in the local test harness), proceed to **Step 5**, and tell the
  user tests couldn't run locally due to a toolchain version mismatch. Do not
  loop on it.

(If `npm install` cannot reach the network and the toolchain can't be fetched,
tell the user that's required once, and continue to write correct code so they
can run `npm install && npm test && npm run package` themselves.)

### Step 5: Package and hand off

```sh
npm run package
```

`package` first load-checks the plugin — the same install-time path a real
Owncast server runs. A handler whose gating permission isn't declared in the
manifest (a chat filter without `chat.filter`, a fediverse handler without
`fediverse.inbound`) aborts packaging with the exact error the server would
give at install. Fix the manifest, don't work around the check.

This produces **`<slug>.ocpkg`** in the project directory, a single self-contained
file bundling the manifest, your plugin source (`<slug>.js`), and any `public/`/
`assets/`/`icon.png`/`INSTRUCTIONS.md`. Give the user the path to that file and tell them
how to install it:

> Open **Plugins** in your Owncast admin → **Upload plugin** → select
> `<slug>.ocpkg`. Then review the **Permissions** tab and toggle **Enabled**.
> (Alternatively, drop the file into `data/plugins/` on the server.)

Briefly summarize what the plugin does and which permissions the admin will be
asked to approve, and why each is needed.

---

## Capability map (intent → handler + API + permission)

Match the user's described behavior to these rows. Define the listed handler(s),
call the listed API, and add the listed permission to the manifest. Several rows
combine for richer plugins.

| They want to…                                   | Handler(s)                                   | API call                                  | Permission(s)                          |
| ----------------------------------------------- | -------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| React to chat messages                          | `onChatMessage(msg)`                         | —                                         | — (add `chat.send` to reply)           |
| Reply / post in chat                            | (any handler)                                | `owncast.chat.send(text)` / `.sendAction` | `chat.send`                            |
| Whisper privately to a sender                   | `onChatMessage`/`filterChatMessage`          | `owncast.chat.replyTo(msg, text)`         | `chat.send`                            |
| Run chat commands (`!uptime`, etc.)             | `commands: { uptime: { run(ctx) {} } }`      | `ctx.reply` / `ctx.replyPrivately`        | `chat.send` to reply                  |
| Inspect/modify/drop every message (moderation)  | `filterChatMessage(msg)`                     | `filter.pass/modify/drop`                 | `chat.filter` (required for the handler) |
| Delete a message / kick a client                | (any)                                        | `owncast.chat.deleteMessage` / `.kick`    | `chat.moderate`                        |
| Read recent chat / list clients                 | (any)                                        | `owncast.chat.history()` / `.clients()`   | `chat.history`                         |
| React when stream goes live / stops             | `onStreamStarted` / `onStreamStopped`        | —                                         | —                                      |
| Read live stream state (title, viewers, uptime) | (any)                                        | `owncast.stream.current()`                | `server.read`                          |
| Read server info / socials / emotes / tags      | (any)                                        | `owncast.server.*()`                      | `server.read`                          |
| Store per-user or persistent state              | (any)                                        | `owncast.kv.get/set` (+ `getJSON/setJSON`)| `storage.kv`                           |
| Expose admin-configurable settings              | (read at runtime)                            | `owncast.config.get(key, fallback?)`      | — (declare under `config` in manifest) |
| Call an external API / webhook                  | (any)                                        | `owncast.http.fetch(url, opts?)`          | `network.fetch` + `network.allowedHosts` |
| Do delayed / periodic work                      | `onTick({now})` or `owncast.timer.*`         | `owncast.timer.setTimeout/setInterval`    | — (ambient)                            |
| Serve a web page / overlay / JSON endpoint      | `onHttpRequest(req)` + files in `public/`    | return `{status, headers, body}`          | `http.serve`                           |
| Push realtime updates to a browser              | (any)                                        | `owncast.sse.send(channel, event, data)`  | `http.sse`                             |
| Add an admin settings page in the Owncast UI    | `onHttpRequest` + `public/admin/...`         | —                                         | `http.serve` + `admin.pages` manifest  |
| Add a button under the viewer's stream          | (manifest only, or `owncast.actions.add`)    | —                                         | `ui.modify` (+ `http.serve` if it opens your page) |
| Inject CSS / JS / HTML into the viewer page     | (manifest `styles`/`scripts`/`extraPageContent`) | dynamic `onPageStyles()` / `onPageScripts()` / `onPageContent({slug,user})` | `ui.modify`                            |
| Add a tab to the viewer page                    | optional `onTabContent({slug,user})`         | —                                         | `ui.modify` (+ data perms used)        |
| Upload a file and get a public URL              | (any)                                        | `owncast.storage.upload(name, bytes)`     | `storage.upload`                       |
| Private server-side files                       | (any)                                        | `owncast.fs.*`                            | `storage.fs`                           |
| Send Discord / browser-push / fediverse notice  | (any)                                        | `owncast.notifications.*`                 | `notifications.send`                   |
| Post publicly to the fediverse (high-trust)     | (any)                                        | `owncast.fediverse.post(text)`            | `fediverse.post`                       |
| React to any verified inbound fediverse activity | `onFediverse(activity)` for raw JSON, plus `onFediverseFollow/Like/Repost/Quote/Mention/Reply` for specialized payloads | none | `fediverse.inbound` |
| Read/change video/transcoding config            | (any)                                        | `owncast.videoConfig.read/write`          | `videoconfig.read` / `videoconfig.write` |
| Compose with other plugins via custom events    | emit: `owncast.events.emit`, receive: `on:{}`| `owncast.events.emit(type, payload)`      | `events.emit` (emitter only)           |
| Gate the site behind a member login (paywall) | `onHttpRequest` (login flow) + `onAuthCheck` (re-validation) | `owncast.users.register` + `owncast.auth.grantSession/endSession` | `auth.gate` + `users.register` (+ `http.serve`); model on `examples/js/github-auth` |

**Golden rule:** the `permissions` array must contain exactly the permissions
required by the handlers you register and every `owncast.*` method you call.
Missing one means the call throws and/or the host refuses to load the plugin.
Don't add permissions you don't use, since admins judge trust by the declared list.

---

## Writing handlers

```js
const { definePlugin, owncast, filter } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    // msg: { id, user, clientId?, body, timestamp }. msg.user is a ChatUser
    // object in production ({id, displayName, scopes?}); older hosts and
    // scaffolded test scenarios may send it as a plain display-name string,
    // so read the name defensively.
    const name = typeof msg.user === "string" ? msg.user : msg.user?.displayName;
    if (/^hi\b/i.test(msg.body)) {
      owncast.chat.send(`hello, ${name ?? "there"}!`);
    }
  },
});
```

Define **only** the handlers you need. The SDK derives event subscriptions from
which handlers exist. Full list of handlers: `onChatMessage`,
`filterChatMessage`, `onChatUserJoined`, `onChatUserParted`,
`onChatUserRenamed`, `onMessageModerated`, `onStreamStarted`, `onStreamStopped`,
`onStreamTitleChanged`, `onFediverse`, `onFediverseFollow/Like/Repost/Quote/Mention/Reply`,
`onHttpRequest`, `onTick`, `onSseConnect/Disconnect`, `onTabContent`,
`onPageContent`, `onPageStyles`, `onPageScripts`, and
`on: { "namespace.event"() {} }` for custom events.

Important shape/behavior notes:

- **`msg.user` is a string *or* an object.** In production it's a `ChatUser`
  (`{ id, displayName, scopes? }`). Older hosts and the scaffolded test
  scenarios send a plain display-name string. Read the name defensively:
  `typeof msg.user === "string" ? msg.user : msg.user?.displayName`. For stable
  per-user state and moderator gating use the object form (`msg.user?.id`,
  `msg.user?.scopes?.includes("MODERATOR")`), never match on display name, and
  treat a string or absent user as having no id/scopes. Declarative command
  tables handle moderator gating automatically.
- **Chat text is HTML-escaped on display.** `chat.send`/`sendAction` take plain
  text. The exception is `chat.system(body)`, whose body renders as HTML, so escape
  untrusted content yourself.
- **Filters fail open and are time-capped (50 ms).** `filterChatMessage` must be
  fast. A filter that errors is treated as `filter.pass()`. Five consecutive
  failures auto-disable the plugin for the session.
- **`Date`/`Date.now()` work**, but there is no global `setTimeout`. Use
  `owncast.timer.*`. Timers don't survive a host restart.
- **Chat commands:** declare a `commands` table in `definePlugin`. Command
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
- `admin.pages`: `[{ "title", "path": "/admin/*" }]`, and the host auth-gates matching paths.
- **`network.fetch` also requires `network` block:** `"network": { "allowedHosts": ["api.example.com", "*.weather.com"] }`. The bare wildcard `"*"` is allowed but must be written explicitly. The host rejects the load if `network.fetch` is granted without `allowedHosts`.

## Project layout

```
<slug>/
├── plugin.manifest.json   # identity + permissions
├── icon.png               # optional: admin-list icon (bundled automatically)
├── INSTRUCTIONS.md        # optional: rendered as an admin tab
├── src/plugin.js          # your code
├── public/                # optional: served at /plugins/<slug>/...
├── assets/                # optional: host-read for inlined styles/scripts/HTML (NOT URL-served)
└── __tests__/*.test.js    # scenario tests
```

## Testing

Replace the scaffolded test with scenarios for your behavior. Each scenario
dispatches events and asserts on observed side effects:

```js
const { runScenarios } = require("@owncast/plugin-sdk/testing");

runScenarios([
  {
    name: "greets joining users",
    events: [{ event: "chat.user.joined", payload: { id: "u1", displayName: "alice" } }],
    expect: { chatSends: ["welcome, alice!"] },
  },
]);
```

Step types: `event`, `filter` (with `expect: {action, payload?, reason?}`),
`http` (`{method, path, expect:{status, bodyContains?}}`), `tabContent`,
`pageContent`, `pageStyles`, `pageScripts`, and `authCheck` (drives
`onAuthCheck` for `auth.gate` plugins). Final-state assertions include `chatSends`, `chatActions`,
`chatSystems`, `chatTo`, `sseSends`, `emits`, `kv`, `httpRequests`,
`videoConfigWrites`. Seed inputs with `given` (`given.kv`, `given.config`,
`given.stream`, `given.users`, `given.httpResponses`, etc.). Use `authenticated: true` or a
`user` object on `http` steps to test admin/user-gated endpoints.

Shapes that trip people up:

- **A chat event's `user` can be a string or an object.** The scaffolded tests
  use the string shorthand (`payload: { user: "alice", ... }`), while production sends
  a `{ id, displayName, scopes? }` object. Keep your test payloads and handler in
  sync: if the handler reads `msg.user.id` / `.scopes` (or `.displayName`), pass
  an object (`user: { id: "u1", displayName: "alice" }`). If it reads a bare
  string, pass a string. The defensive read above works with both.
- **`config` values come from the manifest defaults** unless the scenario seeds
  admin overrides via `given.config` (`"given": { "config": { "key": "value" } }`).
  `owncast.config.get("key")` returns the override when seeded, otherwise the
  `default` declared under `config` in `plugin.manifest.json`. Test both paths.
- **One `given.httpResponses` entry per URL pattern.** The `url` is a glob
  matched against the full URL (`"https://api.example.com/user*"` covers any
  query string) and the first match wins, so a sequence where the same URL must
  answer differently across calls can't be modeled by fixtures.

For interactive iteration, `npm run serve` hosts the plugin on
`http://localhost:8080/plugins/<slug>/` with `/_dev/*` endpoints to fire events.

## Common recipes (copy and adapt)

**Greeter** (`permissions: ["chat.send"]`):
```js
module.exports = definePlugin({
  onChatUserJoined(user) { owncast.chat.send(`welcome, ${user.displayName}!`); },
});
```

**Word filter** (`permissions: ["chat.filter"]`):
```js
module.exports = definePlugin({
  filterChatMessage(msg) {
    return /badword/i.test(msg.body) ? filter.drop("blocked") : filter.pass();
  },
});
```

**External fetch on command** (`permissions: ["chat.send","network.fetch"]`, `network.allowedHosts: ["api.ipify.org"]`):
```js
module.exports = definePlugin({
  onChatMessage(msg) {
    if (msg.body.trim() !== "!ip") return;
    const res = owncast.http.fetch("https://api.ipify.org?format=json");
    if (res.status === 200) owncast.chat.send(`IP: ${JSON.parse(res.body).ip}`);
  },
});
```

**Notify Discord on stream start** (`permissions: ["notifications.send"]`):
```js
module.exports = definePlugin({
  onStreamStarted(info) { owncast.notifications.discord(`Live now: ${info.title || "stream"}`); },
});
```

## Where to go deeper

The repository's `docs/PLUGIN_AUTHOR_GUIDE.md` is the exhaustive reference
(every handler, every API method, limits, SSE, admin pages, action buttons,
viewer-page injection, full testing model). Read it when a request needs a
feature this summary only outlines. Worked examples live in `examples/js/`.

The public documentation at <https://owncast.online/docs/plugins> covers the same
ground for authors who want a web reference: the
[JavaScript SDK](https://owncast.online/docs/plugins/sdks/javascript),
[Manifest](https://owncast.online/docs/plugins/manifest),
[Events](https://owncast.online/docs/plugins/events),
[Owncast APIs](https://owncast.online/docs/plugins/apis),
[Permissions](https://owncast.online/docs/plugins/permissions),
[Testing](https://owncast.online/docs/plugins/testing), and
[Packaging](https://owncast.online/docs/plugins/packaging) pages.

## Checklist before you hand off the .ocpkg

- [ ] `name`, `slug`, real `description` set (not the `"An Owncast plugin"` placeholder), and slug valid and matches the directory.
- [ ] `permissions` lists exactly the APIs the code calls, no more and no less.
- [ ] `network.allowedHosts` present if `network.fetch` is used, `ui.modify` present for any UI field, and `chat.filter` present if `filterChatMessage` is defined.
- [ ] `INSTRUCTIONS.md` is written for the person installing/running the plugin (what it does and how to use it once enabled), not the scaffold placeholder, and it ships in the `.ocpkg`.
- [ ] `npm test` passes, or, if it failed only on a toolchain/version skew (not your logic), you confirmed that and said so.
- [ ] `npm run package` produced `<slug>.ocpkg`, you gave the user its path and install instructions, and noted which permissions the admin must approve.
