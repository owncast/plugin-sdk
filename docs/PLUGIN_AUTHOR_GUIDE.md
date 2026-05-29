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
- [Realtime updates (Server-Sent Events)](#realtime-updates-server-sent-events)
- [Admin pages](#admin-pages)
- [Action buttons](#action-buttons)
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

---

## Quick start

```sh
npx create-owncast-plugin@latest my-plugin
cd my-plugin
npm install      # one-time toolchain fetch
npm run build    # compile src/plugin.js to an intermediate build artifact
npm test         # build, then run scenarios from __tests__/
npm run serve    # build, then host the plugin on http://localhost:8080
npm run package  # build, then bundle into my-plugin.ocpkg for distribution
```

Edit `src/plugin.js` to handle events and call Owncast APIs. Edit `plugin.manifest.json` to declare permissions and bot identities. When you're ready to ship, `npm run package` produces the `.ocpkg` you hand to a server admin.

---

## Project layout

```
my-plugin/
├── package.json
├── plugin.manifest.json   # name, version, permissions, bots
├── icon.png               # optional: shown in the admin plugin list
├── src/
│   └── plugin.js          # your code
├── assets/                # optional: served at /plugins/<slug>/...
│   └── index.html
└── __tests__/
    └── plugin.test.js    # scenarios
```

### Plugin icon

Drop an `icon.png` at the root of your project (alongside `plugin.manifest.json`) and the packager will bundle it into the `.ocpkg`. The admin UI fetches it from `/api/plugins/<slug>/icon` and renders it in the plugin list and in the sidebar entry for any plugin that ships an admin page. No `http.serve` permission required: the host serves this path directly. There's no enforced size, but square images at 128×128 or so look clean at the rendered list (32×32) and sidebar (16×16) sizes. Plugins without an icon fall back to a generic puzzle-piece glyph.

Per-button icons on action buttons are separate and live wherever you want in `assets/`; see the [Action buttons](#action-buttons) section.

## The manifest

```json
{
  "api": "1",
  "name": "My Plugin",
  "slug": "my-plugin",
  "version": "0.1.0",
  "description": "Short description for admins",
  "permissions": ["chat.send", "storage.kv"]
}
```

- `name` is the human-readable display name (admin lists, registry cards, default chat-bot identity). Any characters allowed.
- `slug` is the canonical identifier: URL prefix (`/plugins/<slug>/`), plugin-config namespace, on-disk filename, registry primary key. Lowercase letters, digits, and hyphens; starts with a letter; max 64 chars. Optional, the SDK auto-derives one from `name` when you omit it.
- `bot.displayName` (optional) overrides the chat-bot name when the plugin posts to chat. Defaults to `name`.
- `permissions` is the list of capabilities your plugin needs (see below)

## Writing handlers

```js
const { definePlugin, owncast, filter } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  // Chat events
  onChatMessage(msg) {
    /* msg: ChatMessage */
  },
  onChatUserJoined(user) {
    /* user: ChatUser */
  },
  onChatUserParted(user) {},
  onChatUserRenamed(change) {
    /* {user, previousName} */
  },
  onMessageModerated(event) {
    /* {messageId, visible, moderator} */
  },

  // Stream lifecycle
  onStreamStarted(info) {
    /* {startedAt, title, summary} */
  },
  onStreamStopped(info) {
    /* {stoppedAt} */
  },
  onStreamTitleChanged(change) {
    /* {from, to} */
  },

  // Fediverse, engagement metadata
  onFediverseFollow(event) {
    /* {actor: {name, handle, url}} */
  },
  onFediverseLike(event) {
    /* {actor, target: {url}} */
  },
  onFediverseRepost(event) {
    /* {actor, target: {url}} */
  },

  // Fediverse, inbound posts (with content)
  onFediverseMention(post) {
    /* FediverseInboundPost, see below */
  },
  onFediverseReply(post) {
    /* same shape; inReplyTo set */
  },

  // Filter chain (sequential, can mutate or drop)
  filterChatMessage(msg) {
    return filter.pass();
  },
  filterPriority: 100, // optional; lower = earlier in chain

  // HTTP endpoint (any path under /plugins/<your-name>/...)
  onHttpRequest(req) {
    return { status: 200, body: "ok" };
  },

  // Plugin-emitted custom events
  on: {
    "another-plugin.something"(payload) {
      /* ... */
    },
  },
});
```

Only define the handlers you actually need. Missing handlers = no subscription.

### Fediverse inbound posts

`onFediverseMention` and `onFediverseReply` carry a `FediverseInboundPost`, a post that someone on the fediverse made that's relevant to the streamer:

```ts
interface FediverseInboundPost {
  actor: { name: string; handle: string; url?: string; image?: string };
  content: string; // rendered HTML from the source instance
  contentText: string; // plain-text version (HTML stripped), usually what you want
  url: string; // permalink on the source instance
  postedAt: string; // ISO-8601
  inReplyTo?: string; // parent post URL, set when this is a reply
  attachments?: { url: string; mediaType: string; alt?: string }[];
  language?: string;
}
```

`actor.handle` is the fully-qualified fediverse address (e.g. `@alice@fediverse.example`). Use `contentText` for analysis or display; use `content` if you need to render the original HTML formatting.

### Filter handlers

`filterChatMessage(msg)` returns one of:

- `filter.pass()`, let the message through unchanged
- `filter.modify(payload)`, replace the message (subsequent filters see your version)
- `filter.drop(reason)`, drop the message; no later filters or notifications see it

The manifest must declare the `chat.filter` permission, otherwise the host refuses to load the plugin at register time. Reading or rewriting every chat message is a meaningful side-effect, so the admin has to see the permission to grant it.

Filter errors are treated as `filter.pass()` automatically, a buggy plugin can never block chat. Set `filterPriority` (lower = earlier) when order matters.

### HTTP handler

```ts
interface IncomingHttpRequest {
  method: string;
  path: string; // relative to /plugins/<slug>/
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  remoteAddr: string;
  authenticated: boolean; // came from an authenticated Owncast admin
}

interface OutgoingHttpResponse {
  status?: number; // default 200
  headers?: Record<string, string>;
  body?: string;
}
```

Endpoints are public by default. Gate admin features with `req.authenticated`.

## Owncast APIs

Each method requires the matching permission in your manifest:

| API                                                                             | Requires             |
| ------------------------------------------------------------------------------- | -------------------- |
| `owncast.chat.send(text)`                                                       | `chat.send`          |
| `owncast.chat.sendAction(text)` (italic style)                                  | `chat.send`          |
| `owncast.chat.sendTo(clientId, text)`, private message                          | `chat.send`          |
| `owncast.chat.history(limit?)`, recent messages                                 | `chat.history`       |
| `owncast.chat.clients()`, connected chat clients                                | `chat.history`       |
| `owncast.chat.deleteMessage(messageId)`                                         | `chat.moderate`      |
| `owncast.chat.kick(clientId)`                                                   | `chat.moderate`      |
| `owncast.users.list()` / `.get(id)`                                             | `users.read`         |
| `owncast.users.setEnabled(id, enabled, reason?)`                                | `users.moderate`     |
| `owncast.users.banIP(ip)`                                                       | `users.moderate`     |
| `owncast.kv.get(key)` / `.set(key, value)`                                      | `storage.kv`         |
| `owncast.storage.upload(name, bytes)`, returns `{url}`                          | `storage.upload`     |
| `owncast.http.fetch(url, opts?)`                                                | `network.fetch`      |
| `owncast.events.emit(eventType, payload)`                                       | `events.emit`        |
| `owncast.stream.current()`, live stream state                                   | `server.read`        |
| `owncast.stream.broadcaster()`, inbound encode telemetry (read-only)            | `server.read`        |
| `owncast.server.info()`, server name, version, etc.                             | `server.read`        |
| `owncast.server.socials()`, `[{platform, url, icon}]`                           | `server.read`        |
| `owncast.server.federation()`, `{enabled, username, isPrivate}`                 | `server.read`        |
| `owncast.server.tags()`, `[string]`                                             | `server.read`        |
| `owncast.videoConfig.read()`, `{latencyLevel, codec, variants}`                 | `videoconfig.read`   |
| `owncast.videoConfig.write({latencyLevel?, codec?, variants?})`, partial update | `videoconfig.write`  |
| `owncast.notifications.discord(text)`                                           | `notifications.send` |
| `owncast.notifications.browserPush({title, body, url?})`                        | `notifications.send` |
| `owncast.notifications.fediverse({type, body, image?, link?})`                  | `notifications.send` |
| `owncast.fediverse.post(text)`, public post to the fediverse                    | `fediverse.post`     |
| `onHttpRequest` + static `assets/`                                              | `http.serve`         |
| `owncast.sse.send(channel, event, data)`, push to browsers                      | `http.sse`           |

Calling an API without its permission throws a clear error.

### Chat identity

Every plugin has **exactly one chat identity**, the auto-bot Owncast provisions when your plugin is installed. The display name is your plugin's `name` (e.g. `echo-bot`), with `IsBot: true`. `owncast.chat.send(text)` and `owncast.chat.sendAction(text)` both post as this identity, through Owncast's normal chat pipeline (filters, rate limits, persistence, moderation, same as any user).

If you need multiple chat personas, **ship multiple plugins.** One identity per plugin keeps the trust boundary clear: admins see one chat user per granted plugin, and there's no allowlist machinery to forget or bypass. Plugins cannot post under arbitrary names or impersonate real users.

## Permissions

| Permission           | Grants                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.send`          | `owncast.chat.send`, `.sendAction`, `.sendTo`                                                                                                     |
| `chat.history`       | `owncast.chat.history`, `.clients`                                                                                                                |
| `chat.moderate`      | `owncast.chat.deleteMessage`, `.kick`                                                                                                             |
| `chat.filter`        | Subscribe to `filterChatMessage` (read, modify, or drop every chat message). Required for any plugin that declares the handler.                   |
| `users.read`         | `owncast.users.list`, `.get`                                                                                                                      |
| `users.moderate`     | `owncast.users.setEnabled`, `.banIP`                                                                                                              |
| `storage.kv`         | Per-plugin namespaced key/value store                                                                                                             |
| `storage.upload`     | `owncast.storage.upload`, upload files, get a public URL                                                                                          |
| `network.fetch`      | Outbound HTTP, also requires `network.allowedHosts` (see below)                                                                                   |
| `events.emit`        | Emit custom events for other plugins to subscribe to                                                                                              |
| `http.serve`         | Serve HTTP at `/plugins/<your-name>/*`                                                                                                            |
| `http.sse`           | Push realtime events to browsers via `owncast.sse.send` + the `/_sse/` endpoint                                                                   |
| `server.read`        | Read stream state, server config, and read-only broadcast telemetry (`stream.broadcaster`)                                                        |
| `videoconfig.read`   | `owncast.videoConfig.read()`, read the output/transcoding config                                                                                  |
| `videoconfig.write`  | `owncast.videoConfig.write()`, change video config; high-trust. Changes apply on the next stream start (the host does not restart a live stream). |
| `notifications.send` | `owncast.notifications.discord`, `.browserPush`                                                                                                   |
| `fediverse.post`     | `owncast.fediverse.post(text)`, high-trust (posts under the streamer's handle); admin should grant sparingly.                                       |
| `ui.modify`          | Place UI inside Owncast's own chrome. Required for any plugin that declares `manifest.actions`; the host rejects the load otherwise.              |

Declare only what you need. Admins reviewing your manifest before install make trust decisions based on declared permissions.

### Outbound HTTP, `network.allowedHosts`

`network.fetch` is gated by an explicit allowlist of hostnames. The host rejects the load if `network.fetch` is granted without a corresponding `network.allowedHosts` entry:

```json
{
  "permissions": ["network.fetch"],
  "network": {
    "allowedHosts": ["api.discord.com", "*.weather.com"]
  }
}
```

Entries are hostname globs, bare hostnames match exactly; `*` is a wildcard segment. The wildcard `"*"` matches any host but **must be written explicitly** (`"network": { "allowedHosts": ["*"] }`) so admins reviewing the manifest see the scope they're granting. Most plugins should list the specific hosts they actually call.

## Serving HTTP

Anything in your `assets/` directory is served at `/plugins/<your-name>/...`. Requests that don't match a file fall through to your `onHttpRequest` handler.

```
my-plugin/
└── assets/
    ├── index.html        → /plugins/my-plugin/index.html (and /plugins/my-plugin/)
    └── style.css         → /plugins/my-plugin/style.css
```

A request to `/plugins/my-plugin/` serves `assets/index.html` automatically.

For dynamic endpoints (JSON APIs, webhooks, etc.) write an `onHttpRequest`. Path traversal is blocked, response headers are filtered through an allowlist (allowed: `Content-Type`, `Cache-Control`, `Set-Cookie`, `Location`, `ETag`, `Last-Modified`, `Vary`, `Link`, and CORS headers; blocked: host-owned things like `Server`, CSP, HSTS), and body sizes are capped at 1 MB request / 10 MB response. Cookies you set default to a `Path` scoped to your plugin's namespace.

## Realtime updates (Server-Sent Events)

For pushing live updates to a browser, an overlay that reacts to chat, a dashboard that ticks viewer counts, an alert widget, declare `http.sse` and use `owncast.sse.send`.

You do **not** open or hold the connection yourself. Your `onHttpRequest` handler can't stream: each call is a single buffered request/response. Instead, the host owns the long-lived connection and exposes a ready-made endpoint at `/plugins/<your-slug>/_sse/<channel>`. Your plugin just pushes; the host fans each message out to every connected browser.

**Plugin side**, push whenever you have something to send (from an event handler, an HTTP handler, anywhere):

```js
// src/plugin.js
export function onChatMessage(msg) {
  // Notify every browser watching the "overlay" stream.
  owncast.sse.send("overlay", "chat", {
    from: msg.user,
    body: msg.body,
  });
}
```

`send(channel, event, data)`:

- `channel`, which stream to push to. Browsers subscribe per channel, so you can run several independent streams (`"overlay"`, `"admin-stats"`) from one plugin. Use `""` for a single default channel.
- `event`, the event name the browser listens for (`addEventListener("chat", …)`). Pass `""` for the browser's default `message` event.
- `data`, the payload. Strings are sent as-is; anything else is JSON-encoded for you.

Sends are fire-and-forget: the call returns immediately and never blocks, even if no one is connected or a client is slow (slow clients drop frames rather than stall your plugin).

**Browser side**, connect with the standard `EventSource` API, no library needed:

```html
<!-- assets/index.html, served at /plugins/my-plugin/ -->
<script>
  const events = new EventSource("/plugins/my-plugin/_sse/overlay");
  events.addEventListener("chat", (e) => {
    const { from, body } = JSON.parse(e.data);
    document.getElementById("feed").textContent = `${from}: ${body}`;
  });
</script>
```

Notes:

- Up to 64 simultaneous connections per plugin; over that the endpoint returns 503. `EventSource` reconnects automatically.
- If the channel matches one of your `admin.pages[]` globs it's auth-gated like any admin route, handy for an admin-only stats stream.
- The endpoint is host-owned and reserved: your `onHttpRequest` never sees `/_sse/...` requests, and you can't serve your own route there.

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

- `path` is a glob (e.g. `"/admin"`, `"/admin/*"`). Requests under `/plugins/<your-slug>/<path>` that match any declared glob are **auth-gated by the host**, unauthenticated requests get `401` before your plugin code ever runs.
- Owncast's admin renders each declared page as a tab inside `/admin/plugins/configure?slug=<your-slug>`, embedded as an iframe pointed at `/plugins/<your-slug>/<path>`. Each plugin gets its own bookmarkable URL plus a sidebar entry under **Plugins** in the admin nav.
- Both static assets and dynamic endpoints under matched paths are auth-gated; you don't have to check `req.authenticated` yourself.
- The host auto-injects an admin-themed stylesheet (`/styles/admin/plugin-iframe.css`) into HTML responses on admin paths so plain `<input>`/`<button>` controls match Owncast's look without you needing to ship CSS. Plugins that prefer their own styling can layer on top.

Author flow:

1. Put admin HTML/CSS/JS in `assets/admin/index.html` (and friends)
2. Expose admin APIs via `onHttpRequest` at `/admin/api/...`
3. Declare both globs (or just `"/admin/*"`) in `manifest.admin.pages[].path`
4. Visit `/admin/plugins/configure?slug=<your-slug>` in the admin UI (or `/plugins/<your-slug>/admin/` directly). Owncast uses your existing admin login to gate the page; no extra prompt.

## Action buttons

Owncast surfaces a row of "external action" buttons in its UI, clickable entries that either open a URL (in a modal or new tab) or render raw HTML. Plugins can contribute their own. While the plugin is enabled, the host merges its action entries into the list Owncast already shows; when disabled, they disappear.

Declare them in the manifest:

```json
{
  "permissions": ["ui.modify", "http.serve"],
  "actions": [
    {
      "title": "Chat Overlay",
      "description": "Open the live chat overlay",
      "url": "/",
      "icon": "/plugins/my-plugin/icon.svg",
      "color": "#3b82f6"
    },
    {
      "title": "Help",
      "html": "<p>Visit our <a href='https://example.com/docs'>docs</a>.</p>"
    },
    {
      "title": "Issue tracker",
      "url": "https://github.com/example/my-plugin/issues",
      "openExternally": true
    }
  ]
}
```

- **`ui.modify` is required** for any plugin that declares `actions`, because action buttons place UI inside Owncast's own chrome. The host rejects the load otherwise so it's visible at install time that the plugin extends the host UI.
- Exactly one of `url` or `html` is required per entry.
- **Relative URLs auto-prefix.** `"url": "/"` becomes `/plugins/my-plugin/` at load time. `"/stats"` becomes `/plugins/my-plugin/stats`. Saves you from hard-coding your plugin name in your own manifest.
- Absolute `https://...` URLs are accepted unchanged, use them for external links (set `openExternally: true` to open in a new tab).
- If your URL resolves into your own `/plugins/<slug>/` namespace, you must also declare `http.serve` so the page actually serves. The host rejects the load with a clear error otherwise.
- You can't point at another plugin's namespace (`/plugins/some-other-plugin/...`), the host rejects that at load to catch typos.
- **Per-button icons** (`icon` field) follow the same rules as `url`. A relative path like `"/star.png"` auto-prefixes to `/plugins/my-plugin/star.png`, so ship the image under `assets/` and `http.serve` will route it. Absolute `https://cdn.example.com/...` URLs pass through unchanged (use these for external icons that don't need `http.serve`). Cross-plugin icon paths are rejected just like cross-plugin URLs.

This pairs naturally with `http.serve`: ship a UI under `assets/` and declare an action button that opens it.

### Adding buttons at runtime

A plugin can append more action buttons on top of `manifest.actions` without a reload:

```js
owncast.actions.add({
  title: "Donate",
  url: "https://example.com/donate",
  openExternally: true,
});

// or pass an array to add several at once
owncast.actions.add([
  { title: "Tip", url: "https://example.com/tip", openExternally: true },
  { title: "Schedule", html: "<p>Weekdays 8pm UTC.</p>" },
]);

// remove every runtime addition; manifest.actions remain
owncast.actions.clear();
```

The host validates each entry with the same rules as `manifest.actions` (title required, exactly one of `url` / `html`, relative URLs and icons auto-prefixed, cross-plugin URLs/icons rejected) and persists the result in the plugin's config so the additions survive a reload. The next viewer `/api/config` request returns `manifest.actions` ++ the runtime list. Requires `ui.modify`.

A common pattern is an admin page that lets the streamer add a custom button (label + URL) on top of the plugin's defaults; the `action-buttons` example in the SDK ships a working version.

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

Tests live in `__tests__/*.test.js`. They drive your built plugin through the real Owncast plugin runtime with mocked side effects, passing tests guarantee the same behavior in production.

```js
const { runScenarios } = require("@owncast/plugin-sdk/testing");

runScenarios([
  {
    name: "echoes the message",
    events: [
      {
        event: "chat.message.received",
        payload: { user: "alice", body: "hi" },
      },
    ],
    expect: {
      chatSends: ["alice said: hi"],
    },
  },
]);
```

`npm test` builds your wasm, then runs `node __tests__/*.test.js`. Each scenario is a `{ name, given?, events, expect? }` object, the same data model as a JSON scenario file, but in JS you can build the array with loops, helpers, fixtures, or computed payloads.

If you prefer raw JSON, drop `__tests__/*.test.json` files in instead and invoke the runner with `owncast-plugin test`. The data model is identical; the host binary that runs them is the same. Pick whichever is easier to read for the scenarios you're writing.

### Step types

- `event: "<type>"`, fire-and-forget notification dispatch
- `filter: "<type>"`, filter chain; inline `expect: {action, payload?, reason?}` checks the FilterResult
- `http: { method, path, headers?, body?, expect: {status, headers?, body?} }`, sends an HTTP request through your plugin server

### Assertions

Per-step `expect` (on filter and http steps):

- For filters: `action: "pass" | "modify" | "drop"`, `payload`, `reason`
- For HTTP: `status`, `headers`, `body`

Final-state `expect` (on the whole scenario):

- `chatSends`, `chatActions`, `chatSystems`, exact-match lists of chat posts (the bot-sent, "/me" action, and system message variants)
- `videoConfigWrites`, list of partial configs applied via `owncast.videoConfig.write()`
- `emits`, list of `{eventType, payload}` for custom events
- `kv`, partial map of plugin-config state after the scenario
- `httpRequests`, outbound HTTP made by your plugin

### Seeding state with `given`

- `given.kv`, pre-populate your plugin's config namespace
- `given.stream`, what `owncast.stream.current()` returns
- `given.broadcaster`, what `owncast.stream.broadcaster()` returns
- `given.server`, what `owncast.server.info()` returns
- `given.socials` / `given.federation` / `given.tags`, what the matching `owncast.server.*` reads return
- `given.videoConfig`, what `owncast.videoConfig.read()` returns
- `given.chatHistory`, what `owncast.chat.history()` returns
- `given.chatClients`, what `owncast.chat.clients()` returns
- `given.users`, what `owncast.users.list()` / `.get(id)` returns
- `given.httpResponses`, canned responses for outbound `owncast.http.fetch` calls

### Auth in HTTP scenarios

For testing admin endpoints, add `authenticated: true` to an HTTP step:

```js
{
  http: {
    method: "GET",
    path: "/admin/api/settings",
    authenticated: true,
    expect: { status: 200 },
  },
}
```

For testing user-token endpoints, set `user` instead, the user identity is forwarded to the plugin as `req.user`:

```js
{
  http: {
    method: "GET",
    path: "/my-data",
    user: { id: "u1", displayName: "alice", scopes: ["MODERATOR"] },
  },
}
```

Without either flag, requests are treated as unauthenticated; requests to manifest-declared admin paths return 401.

## Local dev server

```sh
npm run serve
```

Loads your plugin and serves it on `http://localhost:8080/plugins/<your-name>/`. Useful for browser-testing static pages and curl-ing HTTP endpoints. Override the port with `PORT=8765 npm run serve`.

It also exposes dev-only endpoints to drive your event and filter handlers (which a plain HTTP server can't reach), and host reads (server info, video config, etc.) return sample dev data:

- `POST /_dev/chat` with `{"user":"alice","body":"hi"}`, runs your `filterChatMessage` chain, then fires `chat.message.received` (`onChatMessage`). The JSON response shows what your filter did.
- `GET /_dev/chat`, the chat log so far, including anything your plugin posted.
- `POST /_dev/event` with `{"type":"stream.started","payload":{}}`, dispatch an arbitrary event to your `onEvent` handlers.

For repeatable assertions use `npm test` (scenario tests); the dev server is for interactive iteration. Many authors run both: dev server in one terminal, test watcher in another.

## Deployment

A `.ocpkg` is the distribution format: a single file containing your `plugin.manifest.json`, the compiled plugin, and your `assets/` directory if you have one. It's what a server admin installs into Owncast; they don't see your `package.json`, `node_modules`, or anything else.

Bundle the `.ocpkg`:

```sh
npm run package
```

The file is self-contained. Share it however you like (release on GitHub, hand it to an admin over chat, host it somewhere). The admin has two ways to install it:

1. **Upload from the admin UI.** Open **Plugins** in the Owncast admin and click **Upload plugin**. The new entry appears in the list immediately.
2. **Drop it into `data/plugins/`** on the server. The directory is scanned periodically; the plugin appears in the admin within a couple of seconds.

Either way, the admin then reviews the **Permissions** tab on the plugin's detail page and toggles **Enabled** to load it. Subsequent updates (uploading a new `.ocpkg` with the same `name`) replace the existing entry and trigger the re-approval flow if the new manifest declares additional permissions.

To remove a plugin, an admin clicks the trash icon on the plugin's row in the **Plugins** page and confirms.

`npm run build` produces only the intermediate compiled output and is faster, useful while iterating. `npm run package` is the step you run when you're ready to ship.

## Recipes

Complete working plugins, also in `examples/js/`:

### Echo bot

Replies to every chat message.

```json
{
  "api": "1",
  "name": "Echo Bot",
  "slug": "echo-bot",
  "version": "0.1.0",
  "permissions": ["chat.send"],
  "bot": { "displayName": "Echo" }
}
```

```js
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    owncast.chat.send(`${msg.user} said: ${msg.body}`);
  },
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
  },
});
```

### Slow mode

Drops rapid follow-ups; uses plugin config for per-user state.

```js
const { definePlugin, filter, owncast } = require("@owncast/plugin-sdk");
const MIN_INTERVAL_MS = 2000;

module.exports = definePlugin({
  filterChatMessage(msg) {
    const now = new Date(msg.timestamp).getTime();
    const last = parseInt(owncast.kv.get(`last:${msg.user}`) || "0", 10);
    if (last && now - last < MIN_INTERVAL_MS) {
      return filter.drop(`${msg.user} must wait ${MIN_INTERVAL_MS}ms`);
    }
    owncast.kv.set(`last:${msg.user}`, String(now));
    return filter.pass();
  },
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
  },
});
```

### Chat overlay (static + dynamic HTTP)

Ships an HTML page that polls a JSON endpoint backed by `owncast.chat.history()`.

```json
{
  "api": "1",
  "name": "Chat Overlay",
  "slug": "overlay",
  "version": "0.1.0",
  "permissions": ["http.serve", "chat.history"]
}
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
        body: JSON.stringify({ messages }),
      };
    }
    return { status: 404 };
  },
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
      document.getElementById("messages").innerHTML = messages
        .map((m) => `<div>${m.user}: ${m.body}</div>`)
        .join("");
    }, 2000);
  </script>
</body>
```

Visit `/plugins/overlay/` to render. Owncast owns the chat history; your plugin just exposes a view of it.

### Stream tracker (lifecycle events, read APIs)

```json
{
  "api": "1",
  "name": "Stream Tracker",
  "slug": "stream-tracker",
  "version": "0.1.0",
  "permissions": ["chat.send", "server.read"]
}
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
      (new Date(msg.timestamp).getTime() -
        new Date(state.startedAt).getTime()) /
        1000,
    );
    owncast.chat.send(`uptime: ${seconds}s, ${state.viewers} viewer(s)`);
  },
});
```

Messages from this plugin appear in chat from the `stream-tracker` bot account, the auto-bot Owncast provisions on install.

### Plugin composition

`relay` watches for `/announce` in chat and emits a custom event; `announcer` subscribes.

```js
// relay/src/plugin.js, needs events.emit
module.exports = definePlugin({
  onChatMessage(msg) {
    if (!msg.body.startsWith("/announce ")) return;
    owncast.events.emit("announcement.broadcast", {
      text: msg.body.substring(10),
      by: msg.user,
    });
  },
});
```

```js
// announcer/src/plugin.js, no permissions needed
module.exports = definePlugin({
  on: {
    "announcement.broadcast"(payload) {
      console.log(`📢 ${payload.by}: ${payload.text}`);
    },
  },
});
```

## Tips

- **TypeScript works**, name your file `src/plugin.ts` instead of `.js`. The SDK ships TypeScript declarations; `import` instead of `require`.
- **npm packages work** as long as they're pure JavaScript (no Node built-ins like `fs` or `http`).
- **`console.log`** in plugin code surfaces in the host log with a `[your-plugin]` prefix. Use it freely for debugging.
- **One handler = one subscription.** Define `onChatMessage` → subscribed. Delete it → unsubscribed. Don't think about it.
- **Mocked tests are fast** (3-5 s including rebuild). Run them on every save.
- **State doesn't leak between scenarios.** Each test gets a fresh plugin instance and a clean in-memory plugin config.

## Failure handling

The runtime watches for filters that consistently throw or hang. Two protections:

**Timeouts.** Each filter call is capped at **50 ms**. Past that, the host cancels the call and treats it as a failure (fail-open: the filter is skipped, the chain continues with the unmodified payload). This protects the chat hot path from a single slow filter.

**Strike system.** After **5 consecutive failures** (errors _or_ timeouts) the host auto-disables the plugin for the rest of the session and logs once:

```
plugin <slug>: auto-disabled after 5 consecutive filter failures
```

Disabled plugins are silently skipped by the filter chain. A successful filter call resets the counter, so transient flakiness doesn't accumulate. To re-enable a disabled plugin, restart the host.

> **Note:** the 50 ms cancellation kicks in when your filter calls back into Owncast (via `owncast.*` APIs, `console.log`, etc.). A tight pure-JS loop with no calls out (e.g. `while(true) {}`) may not be cancelled until the outer 10 s safety net fires, at which point the strike system disables the plugin. Realistic plugin code yields plenty, so this isn't something to design around.
