# AGENTS.md — __PLUGIN_DISPLAY_NAME__

Guidance for AI coding agents working on this Owncast plugin (slug:
`__PLUGIN_SLUG__`). It encodes the SDK's rules so you can add behavior correctly
without re-deriving how the runtime works. Tool-agnostic: "run" means use your
shell tool; follow these steps with whatever model/harness you are.

> **Skill available.** This plugin ships the `create-owncast-plugin` skill at
> `.agents/skills/create-owncast-plugin/SKILL.md`. Skill-aware agents discover it
> automatically; otherwise read that file — it drives the full build-this-plugin
> workflow (turn a plain-language request into handlers + manifest, then test and
> package). This AGENTS.md is the quick reference; the skill is the playbook.

## What this project is

An Owncast plugin: JavaScript that runs sandboxed inside the Owncast server. It
subscribes to events by defining handler functions in `src/plugin.js`, and calls
back into Owncast through the `owncast.*` API. `plugin.manifest.json` declares
the plugin's identity and the **permissions** it needs. The toolchain compiles
the JS to WebAssembly and bundles it into one `__PLUGIN_SLUG__.ocpkg` file for
distribution.

## Files you edit

- `src/plugin.js` — handler code. Define **only** the handlers you need; the SDK
  derives event subscriptions from which handlers exist.
- `plugin.manifest.json` — `name`, `slug`, `version`, `description`,
  `permissions`, optional `bot.displayName`, `config`, and UI fields.
- `__tests__/plugin.test.js` — scenario tests; update them to assert your real behavior.
- `public/` (create if needed) — files served at `/plugins/__PLUGIN_SLUG__/...`.
- `assets/` (create if needed) — host-read for inlined UI (`styles`/`scripts`/
  `extraPageContent`); **not** reachable via URL.

## Workflow

```sh
npm install          # one-time, fetches the wasm toolchain
npm test             # builds, then runs __tests__/*.test.js against the real runtime
npm run package      # builds, then bundles __PLUGIN_SLUG__.ocpkg for distribution
npm run serve        # optional: host on http://localhost:8080 for manual testing
```

Always run `npm test` after changing code, and don't `npm run package` with
failing tests — fix the code or correct the expectation (and say which).

## The golden rule

**The `permissions` array must contain exactly the permission for every
`owncast.*` method you call** — no more, no less. A missing permission makes the
call throw and/or the host refuse to load the plugin. Admins judge trust by the
declared list, so don't over-declare.

## Capability map (intent → handler + API + permission)

| To…                                            | Handler(s)                                   | API call                                  | Permission(s)                          |
| ----------------------------------------------- | -------------------------------------------- | ----------------------------------------- | -------------------------------------- |
| React to chat messages                          | `onChatMessage(msg)`                         | —                                         | — (`chat.send` to reply)               |
| Reply / post in chat                            | (any)                                        | `owncast.chat.send(text)` / `.sendAction` | `chat.send`                            |
| Whisper privately to a sender                   | `onChatMessage`/`filterChatMessage`          | `owncast.chat.replyTo(msg, text)`         | `chat.send`                            |
| Run chat commands (`!cmd`)                      | `onChatMessage: defineCommands({...})`       | `ctx.reply` / `ctx.replyPrivately`        | `chat.send`                            |
| Inspect/modify/drop every message (moderate)    | `filterChatMessage(msg)`                     | `filter.pass/modify/drop`                 | `chat.filter` (required for handler)   |
| Delete a message / kick a client                | (any)                                        | `owncast.chat.deleteMessage` / `.kick`    | `chat.moderate`                        |
| Read recent chat / list clients                 | (any)                                        | `owncast.chat.history()` / `.clients()`   | `chat.history`                         |
| React to stream live / stop                     | `onStreamStarted` / `onStreamStopped`        | —                                         | —                                      |
| Read live stream / server state                 | (any)                                        | `owncast.stream.current()` / `server.*()` | `server.read`                          |
| Store state                                     | (any)                                        | `owncast.kv.get/set` (+ `getJSON/setJSON`)| `storage.kv`                           |
| Admin-configurable settings                     | (read at runtime)                            | `owncast.config.get(key, fallback?)`      | — (declare under `config`)             |
| Call an external API                            | (any)                                        | `owncast.http.fetch(url, opts?)`          | `network.fetch` + `network.allowedHosts` |
| Delayed / periodic work                         | `onTick({now})` / `owncast.timer.*`          | `owncast.timer.setTimeout/setInterval`    | — (ambient; no global setTimeout)      |
| Serve a web page / JSON endpoint / overlay      | `onHttpRequest(req)` + `public/`             | return `{status, headers, body}`          | `http.serve`                           |
| Push realtime updates to a browser              | (any)                                        | `owncast.sse.send(channel, event, data)`  | `http.sse`                             |
| Admin settings page in the Owncast UI           | `onHttpRequest` + `public/admin/...`         | —                                         | `http.serve` + `admin.pages`           |
| Button under the viewer's stream                | manifest `actions` / `owncast.actions.add`   | —                                         | `ui.modify` (+ `http.serve` if it opens your page) |
| Inject CSS / JS / HTML into the viewer page     | manifest `styles`/`scripts`/`extraPageContent` | optional `onPageContent({slug,user})`   | `ui.modify`                            |
| Add a tab to the viewer page                    | optional `onTabContent({slug,user})`         | —                                         | `ui.modify` (+ data perms used)        |
| Upload a file, get a public URL                 | (any)                                        | `owncast.storage.upload(name, bytes)`     | `storage.upload`                       |
| Private server-side files                       | (any)                                        | `owncast.fs.*`                            | `storage.fs`                           |
| Discord / push / fediverse notification         | (any)                                        | `owncast.notifications.*`                 | `notifications.send`                   |
| Post publicly to the fediverse (high-trust)     | (any)                                        | `owncast.fediverse.post(text)`            | `fediverse.post`                       |
| React to fediverse follows/likes/mentions       | `onFediverse*`                               | —                                         | —                                      |
| Read/change video config                        | (any)                                        | `owncast.videoConfig.read/write`          | `videoconfig.read` / `videoconfig.write` |
| Compose with other plugins                      | emit `owncast.events.emit`; receive `on:{}`  | `owncast.events.emit(type, payload)`      | `events.emit` (emitter only)           |

## Gotchas that bite

- **`msg.user` is a string or an object.** Production sends a `ChatUser` (`{id, displayName, scopes?}`); older hosts and the scaffolded test scenarios send a plain display-name string. Read the name as `typeof msg.user === "string" ? msg.user : msg.user?.displayName`. For per-user state and mod gating use the object form (`msg.user?.id`, `msg.user?.scopes?.includes("MODERATOR")`), never the display name, and treat a string/absent user as having no id/scopes.
- **Chat text is HTML-escaped on display.** `chat.send`/`sendAction` take plain text. Only `chat.system(body)` renders HTML — escape untrusted content yourself.
- **Filters are time-capped (50 ms) and fail open.** Keep `filterChatMessage` fast; an erroring filter is treated as `filter.pass()`. Five consecutive failures auto-disable the plugin for the session.
- **No global `setTimeout`** — use `owncast.timer.*` (timers don't survive a host restart). `Date`/`Date.now()` work normally.
- **`network.fetch` requires `network.allowedHosts`** in the manifest, e.g. `"network": { "allowedHosts": ["api.example.com"] }`. The bare `"*"` is allowed but must be explicit.
- **Any UI field** (`actions`, `styles`, `scripts`, `extraPageContent`, `tabs`) **requires `ui.modify`**.
- **Prefer `defineCommands`** over hand-rolled prefix parsing for chat commands — it gives aliases, per-user cooldowns, and `modOnly` gating.

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
`given` (`given.kv`, `given.stream`, `given.users`, `given.httpResponses`, …).
Step types: `event`, `filter`, `http`, `tabContent`, `pageContent`.

## Full reference

The exhaustive author guide — every handler, API method, limit, and testing
pattern — lives at:

**https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md**

`@owncast/plugin-sdk` ships TypeScript declarations, so an editor gives
autocomplete and inline docs on every `owncast.*` call.
