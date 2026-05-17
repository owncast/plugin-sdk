# Writing an Owncast Plugin

How to write, test, and ship a plugin. Aimed at JavaScript developers. Write some JS, run a command, get a plugin.

## Contents

- [Quick start](#quick-start)
- [Project layout](#project-layout)
- [The manifest](#the-manifest)
- [Writing handlers](#writing-handlers)
  - [Fediverse inbound posts](#fediverse-inbound-posts)
  - [Filter handlers](#filter-handlers)
  - [HTTP handler](#http-handler)
- [Owncast APIs](#owncast-apis)
  - [Chat identity](#chat-identity)
- [Permissions](#permissions)
- [Serving HTTP](#serving-http)
- [Admin pages](#admin-pages)
- [Plugin-to-plugin events](#plugin-to-plugin-events)
- [Testing](#testing)
  - [Step types](#step-types)
  - [Assertions](#assertions)
  - [Seeding state with `given`](#seeding-state-with-given)
  - [Auth in HTTP scenarios](#auth-in-http-scenarios)
- [Local dev server](#local-dev-server)
- [Deployment](#deployment)
- [Recipes](#recipes)
  - [Echo bot](#echo-bot)
  - [Profanity filter](#profanity-filter)
  - [Slow mode](#slow-mode)
  - [HTTP fetcher](#http-fetcher)
  - [Chat overlay (static + dynamic HTTP)](#chat-overlay-static--dynamic-http)
  - [Stream tracker (lifecycle events, read APIs)](#stream-tracker-lifecycle-events-read-apis)
  - [Plugin composition](#plugin-composition)
- [Tips](#tips)
- [Failure handling](#failure-handling)
- [What's coming](#whats-coming)

---

## Quick start

```sh
npx create-owncast-plugin my-plugin
cd my-plugin
npm install      # one-time toolchain fetch
npm run build    # bundles your plugin
npm test         # runs the included scenario
npm run serve    # localhost dev server
```

Edit `src/plugin.js` to handle events and call Owncast APIs. Edit `plugin.manifest.json` to declare permissions and bot identities. Ship as a `.ocpkg` file with `npx owncast-plugin package`.

---

## Project layout

```
my-plugin/
├── package.json
├── plugin.manifest.json   # name, version, permissions, bots
├── src/
│   └── plugin.js          # your code
├── assets/                # optional: served at /plugins/<name>/...
│   └── index.html
└── __tests__/
    └── plugin.test.json   # scenarios
```

## The manifest

```json
{
  "api": "1",
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "Short description for admins",
  "permissions": ["chat.send", "storage.kv"]
}
```

- `name` determines your plugin's URL prefix (`/plugins/<name>/`), KV namespace, and chat bot identity
- `permissions` is the list of capabilities your plugin needs (see below)

## Writing handlers

```js
const { definePlugin, owncast, filter } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  // Chat events
  onChatMessage(msg)           { /* msg: ChatMessage */ },
  onChatUserJoined(user)       { /* user: ChatUser */ },
  onChatUserParted(user)       { },
  onChatUserRenamed(change)    { /* {user, previousName} */ },
  onMessageModerated(event)    { /* {messageId, visible, moderator} */ },

  // Stream lifecycle
  onStreamStarted(info)        { /* {startedAt, title, summary} */ },
  onStreamStopped(info)        { /* {stoppedAt} */ },
  onStreamTitleChanged(change) { /* {from, to} */ },

  // Fediverse — engagement metadata
  onFediverseFollow(event)     { /* {actor: {name, handle, url}} */ },
  onFediverseLike(event)       { /* {actor, target: {url}} */ },
  onFediverseRepost(event)     { /* {actor, target: {url}} */ },

  // Fediverse — inbound posts (with content)
  onFediverseMention(post)     { /* FediverseInboundPost — see below */ },
  onFediverseReply(post)       { /* same shape; inReplyTo set */ },

  // Filter chain (sequential, can mutate or drop)
  filterChatMessage(msg)       { return filter.pass(); },
  filterPriority: 100,         // optional; lower = earlier in chain

  // HTTP endpoint (any path under /plugins/<your-name>/...)
  onHttpRequest(req)           { return { status: 200, body: "ok" }; },

  // Plugin-emitted custom events
  on: {
    "another-plugin.something"(payload) { /* ... */ }
  }
});
```

Only define the handlers you actually need. Missing handlers = no subscription.

### Fediverse inbound posts

`onFediverseMention` and `onFediverseReply` carry a `FediverseInboundPost` — a post that someone on the fediverse made that's relevant to the streamer:

```ts
interface FediverseInboundPost {
  actor: { name: string; handle: string; url?: string; image?: string };
  content: string;       // rendered HTML from the source instance
  contentText: string;   // plain-text version (HTML stripped) — usually what you want
  url: string;           // permalink on the source instance
  postedAt: string;      // ISO-8601
  inReplyTo?: string;    // parent post URL — set when this is a reply
  attachments?: { url: string; mediaType: string; alt?: string }[];
  language?: string;
}
```

`actor.handle` is the fully-qualified fediverse address (e.g. `@alice@mastodon.social`). Use `contentText` for analysis or display; use `content` if you need to render the original HTML formatting.

### Filter handlers

`filterChatMessage(msg)` returns one of:
- `filter.pass()` — let the message through unchanged
- `filter.modify(payload)` — replace the message (subsequent filters see your version)
- `filter.drop(reason)` — drop the message; no later filters or notifications see it

Filter errors are treated as `filter.pass()` automatically — a buggy plugin can never block chat. Set `filterPriority` (lower = earlier) when order matters.

### HTTP handler

```ts
interface IncomingHttpRequest {
  method: string;
  path: string;                 // relative to /plugins/<name>/
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  remoteAddr: string;
  authenticated: boolean;       // came from an authenticated Owncast admin
}

interface OutgoingHttpResponse {
  status?: number;              // default 200
  headers?: Record<string, string>;
  body?: string;
}
```

Endpoints are public by default. Gate admin features with `req.authenticated`.

## Owncast APIs

Each method requires the matching permission in your manifest:

| API | Requires |
|---|---|
| `owncast.chat.send(text)` | `chat.send` |
| `owncast.chat.sendAction(text)` (italic style) | `chat.send` |
| `owncast.chat.sendTo(clientId, text)` — private message | `chat.send` |
| `owncast.chat.history(limit?)` — recent messages | `chat.history` |
| `owncast.chat.clients()` — connected chat clients | `chat.history` |
| `owncast.chat.deleteMessage(messageId)` | `chat.moderate` |
| `owncast.chat.kick(clientId)` | `chat.moderate` |
| `owncast.users.list()` / `.get(id)` | `users.read` |
| `owncast.users.setEnabled(id, enabled, reason?)` | `users.moderate` |
| `owncast.users.banIP(ip)` | `users.moderate` |
| `owncast.kv.get(key)` / `.set(key, value)` | `storage.kv` |
| `owncast.storage.upload(name, bytes)` — returns `{url}` | `storage.upload` |
| `owncast.http.fetch(url, opts?)` | `network.fetch` |
| `owncast.events.emit(eventType, payload)` | `events.emit` |
| `owncast.stream.current()` — live stream state | `server.read` |
| `owncast.server.info()` — server name, version, etc. | `server.read` |
| `owncast.server.socials()` — `[{platform, url, icon}]` | `server.read` |
| `owncast.server.federation()` — `{enabled, username, isPrivate}` | `server.read` |
| `owncast.notifications.discord(text)` | `notifications.send` |
| `owncast.notifications.browserPush({title, body, url?})` | `notifications.send` |
| `owncast.notifications.fediverse({type, body, image?, link?})` | `notifications.send` |
| `owncast.fediverse.post(text)` — public post to the fediverse | `fediverse.post` |
| `onHttpRequest` + static `assets/` | `http.serve` |

Calling an API without its permission throws a clear error.

### Chat identity

Every plugin has **exactly one chat identity** — the auto-bot Owncast provisions when your plugin is installed. The display name is your plugin's `name` (e.g. `echo-bot`), with `IsBot: true`. `owncast.chat.send(text)` and `owncast.chat.sendAction(text)` both post as this identity, through Owncast's normal chat pipeline (filters, rate limits, persistence, moderation — same as any user).

If you need multiple chat personas, **ship multiple plugins.** One identity per plugin keeps the trust boundary clear: admins see one chat user per granted plugin, and there's no allowlist machinery to forget or bypass. Plugins cannot post under arbitrary names or impersonate real users.

## Permissions

| Permission | Grants |
|---|---|
| `chat.send` | `owncast.chat.send`, `.sendAction`, `.sendTo` |
| `chat.history` | `owncast.chat.history`, `.clients` |
| `chat.moderate` | `owncast.chat.deleteMessage`, `.kick` |
| `users.read` | `owncast.users.list`, `.get` |
| `users.moderate` | `owncast.users.setEnabled`, `.banIP` |
| `storage.kv` | Per-plugin namespaced key/value store |
| `storage.upload` | `owncast.storage.upload` — upload files, get a public URL |
| `network.fetch` | Outbound HTTP to any host |
| `events.emit` | Emit custom events for other plugins to subscribe to |
| `http.serve` | Serve HTTP at `/plugins/<your-name>/*` |
| `server.read` | Read stream state + server config |
| `notifications.send` | `owncast.notifications.discord`, `.browserPush` |
| `fediverse.post` | `owncast.fediverse.post(text)` — high-trust; admin should grant sparingly. Host rate-limits at ~5/hour per plugin. |

Declare only what you need. Admins reviewing your manifest before install make trust decisions based on declared permissions.

## Serving HTTP

Anything in your `assets/` directory is served at `/plugins/<your-name>/...`. Requests that don't match a file fall through to your `onHttpRequest` handler.

```
my-plugin/
└── assets/
    ├── index.html        → /plugins/my-plugin/index.html (and /plugins/my-plugin/)
    └── style.css         → /plugins/my-plugin/style.css
```

A request to `/plugins/my-plugin/` serves `assets/index.html` automatically.

For dynamic endpoints (JSON APIs, webhooks, etc.) write an `onHttpRequest`. Path traversal is blocked, response headers are filtered (no `Set-Cookie`, etc.), and body sizes are capped at 1 MB request / 10 MB response.

## Admin pages

Plugins can register pages that appear in the Owncast admin UI for configuration. Declare them in the manifest:

```json
{
  "permissions": ["http.serve"],
  "admin": {
    "pages": [
      { "title": "Settings", "path": "/admin", "icon": "gear" },
      { "title": "Settings", "path": "/admin/*" }
    ]
  }
}
```

- `path` is a glob (e.g. `"/admin"`, `"/admin/*"`). Requests under `/plugins/<your-name>/<path>` that match any declared glob are **auth-gated by the host** — unauthenticated requests get `401` before your plugin code ever runs.
- Owncast renders the admin UI in an iframe pointed at `/plugins/<your-name>/<path>`.
- Both static assets and dynamic endpoints under matched paths are auth-gated; you don't have to check `req.authenticated` yourself.

Author flow:

1. Put admin HTML/CSS/JS in `assets/admin/index.html` (and friends)
2. Expose admin APIs via `onHttpRequest` at `/admin/api/...`
3. Declare both globs (or just `"/admin/*"`) in `manifest.admin.pages[].path`
4. Visit `/plugins/<your-name>/admin/` — Owncast challenges for admin auth, then renders your page

## Plugin-to-plugin events

Plugins compose by emitting custom events:

```js
// Emitter (needs events.emit permission)
owncast.events.emit("my-plugin.thing-happened", { id: 123 });

// Subscriber
on: {
  "my-plugin.thing-happened"(payload) { /* ... */ }
}
```

Use `<your-plugin>.<event>` namespacing. Event names are arbitrary strings.

## Testing

Tests live in `__tests__/*.test.json`. They drive your built plugin through the real Owncast plugin runtime with mocked side effects — passing tests guarantee the same behavior in production.

```json
[
  {
    "name": "echoes the message",
    "events": [
      { "event": "chat.message.received",
        "payload": { "user": "alice", "body": "hi" } }
    ],
    "expect": {
      "chatSends": ["alice said: hi"]
    }
  }
]
```

### Step types

- `event: "<type>"` — fire-and-forget notification dispatch
- `filter: "<type>"` — filter chain; inline `expect: {action, payload?, reason?}` checks the FilterResult
- `http: { method, path, headers?, body?, expect: {status, headers?, body?} }` — sends an HTTP request through your plugin server

### Assertions

Per-step `expect` (on filter and http steps):
- For filters: `action: "pass" | "modify" | "drop"`, `payload`, `reason`
- For HTTP: `status`, `headers`, `body`

Final-state `expect` (on the whole scenario):
- `chatSends`, `chatActions`, `chatAs` — exact-match lists of chat posts
- `emits` — list of `{eventType, payload}` for custom events
- `kv` — partial map of KV state after the scenario
- `httpRequests` — outbound HTTP made by your plugin

### Seeding state with `given`

- `given.kv` — pre-populate your plugin's KV
- `given.stream` — what `owncast.stream.current()` returns
- `given.server` — what `owncast.server.info()` returns
- `given.chatHistory` — what `owncast.chat.history()` returns
- `given.chatClients` — what `owncast.chat.clients()` returns
- `given.users` — what `owncast.users.list()` / `.get(id)` returns
- `given.httpResponses` — canned responses for outbound `owncast.http.fetch` calls

### Auth in HTTP scenarios

For testing admin endpoints, add `"authenticated": true` to an HTTP step:

```json
{
  "http": {
    "method": "GET",
    "path": "/admin/api/settings",
    "authenticated": true,
    "expect": { "status": 200 }
  }
}
```

For testing user-token endpoints, set `user` instead — the user identity is forwarded to the plugin as `req.user`:

```json
{
  "http": {
    "method": "GET",
    "path": "/my-data",
    "user": { "id": "u1", "displayName": "alice", "scopes": ["MODERATOR"] }
  }
}
```

Without either flag, requests are treated as unauthenticated; requests to manifest-declared admin paths return 401.

## Local dev server

```sh
npm run serve
```

Loads your plugin and serves it on `http://localhost:8080/plugins/<your-name>/`. Useful for browser-testing static pages and curl-ing HTTP endpoints. Override the port with `PORT=8765 npm run serve`.

The dev server doesn't simulate chat events — use `npm test` for handler iteration. Many authors run both in parallel: dev server in one terminal, test watcher in another.

## Deployment

Build a single `.ocpkg` file:

```sh
npx owncast-plugin package
```

Drop the resulting `my-plugin.ocpkg` into your Owncast server's `plugins/` directory and enable it in the admin. That's it.

## Recipes

Complete working plugins, also in `examples/`:

### Echo bot

Replies to every chat message.

```json
{ "api": "1", "name": "echo-bot", "version": "0.1.0",
  "permissions": ["chat.send"] }
```

```js
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    owncast.chat.send(`${msg.user} said: ${msg.body}`);
  }
});
```

### Profanity filter

```js
const { definePlugin, filter } = require("@owncast/plugin-sdk");
const WORDLIST = ["damn", "hell", "crap"];

module.exports = definePlugin({
  filterChatMessage(msg) {
    let body = msg.body;
    let modified = false;
    for (const word of WORDLIST) {
      const re = new RegExp("\\b" + word + "\\b", "gi");
      if (re.test(body)) {
        body = body.replace(re, "*".repeat(word.length));
        modified = true;
      }
    }
    return modified ? filter.modify({ ...msg, body }) : filter.pass();
  }
});
```

### Slow mode

Drops rapid follow-ups; uses KV for per-user state.

```js
const { definePlugin, filter, owncast } = require("@owncast/plugin-sdk");
const MIN_INTERVAL_MS = 2000;

module.exports = definePlugin({
  filterChatMessage(msg) {
    const now = new Date(msg.timestamp).getTime();
    const last = parseInt(owncast.kv.get(`last:${msg.user}`) || "0", 10);
    if (last && (now - last) < MIN_INTERVAL_MS) {
      return filter.drop(`${msg.user} must wait ${MIN_INTERVAL_MS}ms`);
    }
    owncast.kv.set(`last:${msg.user}`, String(now));
    return filter.pass();
  }
});
```

### HTTP fetcher

Responds to `!ip` by calling an external API.

```js
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    if (msg.body.trim() !== "!ip") return;
    const res = owncast.http.fetch("https://api.ipify.org?format=json");
    if (res.status !== 200) return;
    const { ip } = JSON.parse(res.body);
    owncast.chat.send(`server IP: ${ip}`);
  }
});
```

### Chat overlay (static + dynamic HTTP)

Ships an HTML page that polls a JSON endpoint backed by `owncast.chat.history()`.

```json
{ "api": "1", "name": "overlay", "version": "0.1.0",
  "permissions": ["http.serve", "chat.history"] }
```

```js
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onHttpRequest(req) {
    if (req.method === "GET" && req.path === "/api/messages") {
      const messages = owncast.chat.history(20);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages })
      };
    }
    return { status: 404 };
  }
});
```

```html
<!-- assets/index.html -->
<!doctype html>
<body>
  <div id="messages"></div>
  <script>
    setInterval(async () => {
      const { messages } = await (await fetch("./api/messages")).json();
      document.getElementById("messages").innerHTML =
        messages.map(m => `<div>${m.user}: ${m.body}</div>`).join("");
    }, 2000);
  </script>
</body>
```

Visit `/plugins/overlay/` to render. Owncast owns the chat history; your plugin just exposes a view of it.

### Stream tracker (lifecycle events, read APIs)

```json
{ "api": "1", "name": "stream-tracker", "version": "0.1.0",
  "permissions": ["chat.send", "server.read"] }
```

```js
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onStreamStarted(info) {
    owncast.chat.sendAction(`is live: ${info.title || "stream"}`);
  },
  onChatMessage(msg) {
    if (msg.body.trim() !== "!uptime") return;
    const state = owncast.stream.current();
    if (!state.online) {
      owncast.chat.send("stream is offline");
      return;
    }
    const seconds = Math.floor(
      (new Date(msg.timestamp).getTime() - new Date(state.startedAt).getTime()) / 1000
    );
    owncast.chat.send(`uptime: ${seconds}s, ${state.viewers} viewer(s)`);
  }
});
```

Messages from this plugin appear in chat from the `stream-tracker` bot account — the auto-bot Owncast provisions on install.

### Plugin composition

`relay` watches for `/announce` in chat and emits a custom event; `announcer` subscribes.

```js
// relay/src/plugin.js — needs events.emit
module.exports = definePlugin({
  onChatMessage(msg) {
    if (!msg.body.startsWith("/announce ")) return;
    owncast.events.emit("announcement.broadcast", {
      text: msg.body.substring(10),
      by: msg.user
    });
  }
});
```

```js
// announcer/src/plugin.js — no permissions needed
module.exports = definePlugin({
  on: {
    "announcement.broadcast"(payload) {
      console.log(`📢 ${payload.by}: ${payload.text}`);
    }
  }
});
```

## Tips

- **TypeScript works** — name your file `src/plugin.ts` instead of `.js`. The SDK ships TypeScript declarations; `import` instead of `require`.
- **npm packages work** as long as they're pure JavaScript (no Node built-ins like `fs` or `http`).
- **`console.log`** in plugin code surfaces in the host log with a `[your-plugin]` prefix. Use it freely for debugging.
- **One handler = one subscription.** Define `onChatMessage` → subscribed. Delete it → unsubscribed. Don't think about it.
- **Mocked tests are fast** (3-5 s including rebuild). Run them on every save.
- **State doesn't leak between scenarios.** Each test gets a fresh plugin instance and a clean in-memory KV.

## Failure handling

The runtime watches for filters that consistently throw or hang. Two protections:

**Timeouts.** Each filter call is capped at **50 ms**. Past that, the host cancels the call and treats it as a failure (fail-open: the filter is skipped, the chain continues with the unmodified payload). This protects the chat hot path from a single slow filter.

**Strike system.** After **5 consecutive failures** (errors *or* timeouts) the host auto-disables the plugin for the rest of the session and logs once:

```
plugin <name>: auto-disabled after 5 consecutive filter failures
```

Disabled plugins are silently skipped by the filter chain. A successful filter call resets the counter, so transient flakiness doesn't accumulate. To re-enable a disabled plugin, restart the host.

> **Note:** the 50 ms cancellation kicks in when your filter calls back into Owncast (via `owncast.*` APIs, `console.log`, etc.). A tight pure-JS loop with no calls out (e.g. `while(true) {}`) may not be cancelled until the outer 10 s safety net fires — at which point the strike system disables the plugin. Realistic plugin code yields plenty, so this isn't something to design around.

## What's coming

Capabilities planned for future releases (see [HOST_API_ROADMAP.md](./HOST_API_ROADMAP.md) for status):

- `owncast.server.streamConfig()` — read transcoding variants, codecs, latency
- Filter timeouts — per-plugin and per-chain budget on the chat hot path
- Plugin install/uninstall flow from the admin UI
