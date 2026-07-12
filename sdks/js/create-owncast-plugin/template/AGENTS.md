# AGENTS.md: __PLUGIN_DISPLAY_NAME__

Guidance for AI coding agents working on this Owncast plugin (slug:
`__PLUGIN_SLUG__`). It encodes the SDK's rules so you can add behavior correctly
without re-deriving how the runtime works. Tool-agnostic: "run" means use your
shell tool. Follow these steps with whatever model/harness you are.

> **Skill available.** This plugin ships the `create-owncast-plugin-js` skill at
> `.agents/skills/create-owncast-plugin-js/SKILL.md`. Skill-aware agents discover it
> automatically, otherwise read that file. It drives the full build-this-plugin
> workflow (turn a plain-language request into handlers + manifest, then test and
> package). This AGENTS.md is the quick reference, and the skill is the playbook.

## What this project is

An Owncast plugin: JavaScript that runs sandboxed inside the Owncast server. It
subscribes to events by defining handler functions in `src/plugin.js`, and calls
back into Owncast through the `owncast.*` API. `plugin.manifest.json` declares
the plugin's identity and the **permissions** it needs. Plugins ship as source
and run on the JavaScript engine the Owncast host embeds (no wasm compile step).
`npm run package` bundles your code into one `__PLUGIN_SLUG__.ocpkg` file for
distribution.

## Files you edit

- `src/plugin.js`: handler code. Define **only** the handlers you need. The SDK
  derives event subscriptions from which handlers exist.
- `plugin.manifest.json`: `name`, `slug`, `version`, `description`,
  `permissions`, optional `bot.displayName`, `config`, and UI fields.
- `__tests__/plugin.test.js`: scenario tests. Update them to assert your real behavior.
- `public/` (create if needed): files served at `/plugins/__PLUGIN_SLUG__/...`.
- `assets/` (create if needed): host-read for inlined UI (`styles`/`scripts`/
  `extraPageContent`), but **not** reachable via URL.

## Workflow

```sh
npm install          # one-time, fetches the prebuilt test/serve host binaries
npm test             # builds, then runs __tests__/*.test.js against the real runtime
npm run package      # builds, then bundles __PLUGIN_SLUG__.ocpkg for distribution
npm run serve        # optional: host on http://localhost:8080 for manual testing
```

Always run `npm test` after changing code, and don't `npm run package` with
failing tests. Fix the code or correct the expectation (and say which).

## The golden rule

**The `permissions` array must contain exactly the permissions required by the
handlers you register and every `owncast.*` method you call**, no more and no
less. A missing permission makes the call throw and/or the host refuse to load
the plugin. Admins judge trust by the declared list, so don't over-declare.

## Capability map (intent → handler + API + permission)

| To…                                            | Handler(s)                                   | API call                                  | Permission(s)                          |
| ----------------------------------------------- | -------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| React to chat messages                          | `onChatMessage(msg)`                         | —                                         | — (`chat.send` to reply)               |
| Reply / post in chat                            | (any)                                        | `owncast.chat.send(text)` / `.sendAction` | `chat.send`                            |
| Whisper privately to a sender                   | `onChatMessage`/`filterChatMessage`          | `owncast.chat.replyTo(msg, text)`         | `chat.send`                            |
| Run chat commands (`!cmd`)                      | `commands: { cmd: { run(ctx) {} } }`         | `ctx.reply` / `ctx.replyPrivately`        | `chat.send` to reply                  |
| Inspect/modify/drop every message (moderate)    | `filterChatMessage(msg)`                     | `filter.pass/modify/drop`                 | `chat.filter` (required for handler)   |
| Delete a message / kick a client                | (any)                                        | `owncast.chat.deleteMessage` / `.kick`    | `chat.moderate`                        |
| Read recent chat / list clients                 | (any)                                        | `owncast.chat.history()` / `.clients()`   | `chat.history`                         |
| React to stream live / stop                     | `onStreamStarted` / `onStreamStopped`        | —                                         | —                                      |
| Read live stream / server state                 | (any)                                        | `owncast.stream.current()` / `server.*()` | `server.read`                          |
| Store state                                     | (any)                                        | `owncast.kv.get/set` (+ `getJSON/setJSON`)| `storage.kv`                           |
| Admin-configurable settings                     | (read at runtime)                            | `owncast.config.get(key, fallback?)`      | — (declare under `config`)             |
| Call an external API                            | (any)                                        | `owncast.http.fetch(url, opts?)`          | `network.fetch` + `network.allowedHosts` |
| Delayed / periodic work                         | `onTick({now})` / `owncast.timer.*`          | `owncast.timer.setTimeout/setInterval`    | — (ambient, no global setTimeout)      |
| Serve a web page / JSON endpoint / overlay      | `onHttpRequest(req)` + `public/`             | return `{status, headers, body}`          | `http.serve`                           |
| Push realtime updates to a browser              | (any)                                        | `owncast.sse.send(channel, event, data)`  | `http.sse`                             |
| Admin settings page in the Owncast UI           | `onHttpRequest` + `public/admin/...`         | —                                         | `http.serve` + `admin.pages`           |
| Button under the viewer's stream                | manifest `actions` / `owncast.actions.add`   | —                                         | `ui.modify` (+ `http.serve` if it opens your page) |
| Inject CSS / JS / HTML into the viewer page     | manifest `styles`/`scripts`/`extraPageContent` | dynamic: `onPageStyles()` / `onPageScripts()` / `onPageContent({slug,user})` | `ui.modify`                            |
| Add a tab to the viewer page                    | optional `onTabContent({slug,user})`         | —                                         | `ui.modify` (+ data perms used)        |
| Upload a file, get a public URL                 | (any)                                        | `owncast.storage.upload(name, bytes)`     | `storage.upload`                       |
| Private server-side files                       | (any)                                        | `owncast.fs.*`                            | `storage.fs`                           |
| Discord / push / fediverse notification         | (any)                                        | `owncast.notifications.*`                 | `notifications.send`                   |
| Post publicly to the fediverse (high-trust)     | (any)                                        | `owncast.fediverse.post(text)`            | `fediverse.post`                       |
| React to any verified inbound fediverse activity | `onFediverse(activity)` for raw JSON, plus `onFediverseFollow/Like/Repost/Quote/Mention/Reply` for specialized payloads | none | `fediverse.inbound` |
| Read/change video config                        | (any)                                        | `owncast.videoConfig.read/write`          | `videoconfig.read` / `videoconfig.write` |
| Compose with other plugins                      | emit `owncast.events.emit`, receive `on:{}`  | `owncast.events.emit(type, payload)`      | `events.emit` (emitter only)           |
| Gate the whole site behind a member login (paywall) | `onHttpRequest` (login flow) + `onAuthCheck` (re-validation) | `owncast.users.register` + `owncast.auth.grantSession/endSession` | `auth.gate` + `users.register` (+ `http.serve`) |

## Gotchas that bite

- **`msg.user` is a string or an object.** Production sends a `ChatUser` (`{id, displayName, scopes?}`). Older hosts and the scaffolded test scenarios send a plain display-name string. Read the name as `typeof msg.user === "string" ? msg.user : msg.user?.displayName`. For per-user state and mod gating use the object form (`msg.user?.id`, `msg.user?.scopes?.includes("MODERATOR")`), never the display name, and treat a string/absent user as having no id/scopes.
- **Chat text is HTML-escaped on display.** `chat.send`/`sendAction` take plain text. Only `chat.system(body)` renders HTML, so escape untrusted content yourself.
- **Filters are time-capped (50 ms) and fail open.** Keep `filterChatMessage` fast. An erroring filter is treated as `filter.pass()`. Five consecutive failures auto-disable the plugin for the session.
- **No global `setTimeout`.** Use `owncast.timer.*` (timers don't survive a host restart). `Date`/`Date.now()` work normally.
- **`network.fetch` requires `network.allowedHosts`** in the manifest, e.g. `"network": { "allowedHosts": ["api.example.com"] }`. The bare `"*"` is allowed but must be explicit.
- **Any UI field** (`actions`, `styles`, `scripts`, `extraPageContent`, `tabs`) **requires `ui.modify`**.
- **Declare chat commands in `definePlugin({ commands: {...} })`.** Command tables support aliases, moderator gating, and per-user cooldowns. Unknown and gated invocations are silent.
- **Config in tests:** `owncast.config.get` returns manifest defaults unless the scenario seeds admin overrides via `given.config` (`"given": { "config": { "key": "value" } }`). Test both the override and the default/unconfigured path.
- **One `given.httpResponses` entry per URL pattern.** The `url` is a glob on the full URL and the first match wins, so same-URL sequences (401, then 200 after a refresh) can't be modeled by fixtures.

## Testing

Each scenario dispatches events and asserts side effects:

```js
const { runScenarios } = require("@owncast/plugin-sdk/testing");
runScenarios([
  { name: "...", events: [{ event: "chat.message.received", payload: { id:"1", user:"alice", body:"hi", timestamp:"2024-01-01T00:00:00Z" } }],
    expect: { chatSends: ["..."] } },
]);
```

Final-state assertions: `chatSends`, `chatActions`, `chatSystems`, `chatTo`,
`sseSends`, `emits`, `kv`, `httpRequests`, `videoConfigWrites`. Seed inputs with
`given` (`given.kv`, `given.config`, `given.stream`, `given.users`,
`given.httpResponses`, …).
Step types: `event`, `filter`, `http`, `tabContent`, `pageContent`,
`pageStyles`, `pageScripts`, `authCheck` (drives `onAuthCheck` for
`auth.gate` plugins).

## Full reference

The exhaustive author guide, covering every handler, API method, limit, and
testing pattern, lives at:

**https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md**

`@owncast/plugin-sdk` ships TypeScript declarations, so an editor gives
autocomplete and inline docs on every `owncast.*` call.
