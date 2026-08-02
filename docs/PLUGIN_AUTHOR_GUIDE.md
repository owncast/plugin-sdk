# Writing an Owncast Plugin

How to write, test, and ship a plugin. Aimed at JavaScript developers. Write some JS, run a command, get a plugin.

> There's also a **Python SDK** (`owncast-plugin-py`) with the same capabilities
> and a parallel API (snake_case fields, `@plugin` decorators / `plugin.commands`).
> This guide's examples are JavaScript. The `examples/python/` directory mirrors
> every example shown here. Either way you ship source, and the host runs it on a
> shared, embedded interpreter engine, so plugins don't bundle a runtime and
> packages are a few KB.

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
- [Limits](#limits)
- [Serving HTTP](#serving-http)
- [Realtime updates (Server-Sent Events)](#realtime-updates-server-sent-events)
- [Admin pages](#admin-pages)
- [Viewer authentication gates](#viewer-authentication-gates)
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
npm install      # one-time: fetches the test/serve binaries
npm run build    # bundle src/plugin.js into the shippable plugin.js
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
├── INSTRUCTIONS.md        # optional: rendered as a tab in the admin
├── src/
│   └── plugin.js          # your code
├── public/                # optional: served at /plugins/<slug>/...
│   └── index.html
├── assets/                # optional: host-read for manifest fields that
│   └── theme.css          # inline content (styles, scripts, extraPageContent);
                           # never reachable through the plugin's URL space
└── __tests__/
    └── plugin.test.js    # scenarios
```

The two directories serve different purposes:

- `public/` is the web-served root. Files under it are reachable at `/plugins/<your-slug>/<path>` while the plugin is enabled (and the manifest declares `http.serve`).
- `assets/` is the internal-only root. Files under it are read by the host for manifest fields that inline content (`styles`, `scripts`, `extraPageContent`). They are not reachable through the plugin's URL space.

### Plugin icon

Drop an `icon.png` at the root of your project (alongside `plugin.manifest.json`) and the packager will bundle it into the `.ocpkg`. The admin UI fetches it from `/api/plugins/<slug>/icon` and renders it in the plugin list and in the sidebar entry for any plugin that ships an admin page. No `http.serve` permission required: the host serves this path directly. There's no enforced size, but square images at 128×128 or so look clean at the rendered list (32×32) and sidebar (16×16) sizes. Plugins without an icon fall back to a generic puzzle-piece glyph.

Per-button icons on action buttons are separate. Bundle the image under `public/` so the host serves it at the icon URL, then reference it from the `icon` field of an `actions[]` entry. See the [Action buttons](#action-buttons) section.

### Instructions

Drop an `INSTRUCTIONS.md` at the root of your project (alongside `plugin.manifest.json`) and the packager bundles it into the `.ocpkg`. The admin UI renders it as markdown in an **Instructions** tab on the plugin's details page. Every plugin gets a details page, so this is the place for setup steps, configuration notes, or an explanation of why each permission is requested. The filename is fixed (`INSTRUCTIONS.md`) and the file is optional. No `http.serve` permission is required, since the host serves the content to the admin directly. Plugins without one show no Instructions tab.

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
- `slug` is the canonical identifier: URL prefix (`/plugins/<slug>/`), plugin-config namespace, on-disk filename, registry primary key. Lowercase letters, digits, and hyphens, starting with a letter, max 64 chars. Optional, the SDK auto-derives one from `name` when you omit it.
- `bot.displayName` (optional) overrides the chat-bot name when the plugin posts to chat. Defaults to `name`.
- `permissions` is the list of capabilities your plugin needs (see below)
- `category` (optional) is the plugin's browse category in the plugin registry. One canonical slug from the table below. See [Category](#category).
- `actions` (optional) declares action buttons that appear under the viewer's stream. Requires `ui.modify`. See [Action buttons](#action-buttons).
- `admin.pages` (optional) declares admin-only routes the host auth-gates. See [Admin pages](#admin-pages).
- `styles`, `scripts`, `extraPageContent` (optional) inline plugin CSS, JavaScript, and HTML into the viewer page. All three require `ui.modify` (no `http.serve` needed, the host reads from `assets/` and inlines into existing responses). See [Viewer-page injection](#viewer-page-injection).
- `tabs` (optional) adds tabs to the viewer page's tab row, each with its own HTML body. Requires `ui.modify`. See [Viewer-page tabs](#viewer-page-tabs).

### Category

The optional `category` field tells the plugin registry (and the admin's plugin browser) how to file your plugin for browse filtering. Pick the one canonical slug that best describes what the plugin does:

| Slug              | Display name        |
| ----------------- | ------------------- |
| `chat-bots`       | Chat bots           |
| `chat-filters`    | Chat filters        |
| `moderation`      | Moderation          |
| `authentication`  | Authentication      |
| `themes`          | Themes              |
| `overlays`        | Overlays & widgets  |
| `notifications`   | Notifications       |
| `integrations`    | Integrations        |
| `video`           | Video & streaming   |
| `analytics`       | Analytics & stats   |
| `games`           | Games & fun         |
| `admin-utilities` | Admin utilities     |
| `examples`        | Examples            |
| `other`           | Other               |

Unknown values don't fail the build or the host load, the SDK packagers just warn, and the registry won't match the plugin to any category filter.

## Writing handlers

```js
const { definePlugin, owncast, filter } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  // Chat events
  onChatMessage(msg) {
    /* msg: ChatMessage */
  },
  onChatUserJoined(user) {
    /* user: User */
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
  onFediverseQuote(event) {
    /* {actor, target: {url}}; target is the locally authored quoted post */
  },

  // Fediverse, inbound posts (with content)
  onFediverseMention(post) {
    /* FediverseInboundPost, see below */
  },
  onFediverseReply(post) {
    /* same shape; inReplyTo set */
  },

  // Every verified inbound activity, including activities handled above
  onFediverse(activity) {
    /* raw ActivityPub JSON object */
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

All seven Fediverse handlers require `fediverse.inbound`: `onFediverse`, `onFediverseFollow`, `onFediverseLike`, `onFediverseRepost`, `onFediverseQuote`, `onFediverseMention`, and `onFediverseReply`. These are internal plugin event subscriptions, not external HTTP webhooks. `fediverse.post` is a separate permission for publishing outbound posts.

### Chat message shape

`onChatMessage(msg)` and `filterChatMessage(msg)` receive a `ChatMessage`:

```ts
interface ChatMessage {
  id: string;
  user?: User; // full sender identity (see below); absent if no account
  clientId?: number; // originating connection; pass to chat.sendTo / replyTo
  body: string; // the raw text the user typed (not HTML-rendered)
  timestamp: string; // ISO-8601, nanosecond precision
}

interface User {
  id: string;
  displayName: string;
  displayColor: number; // index into the instance's user-color palette, not a literal color
  previousNames?: string[];
  createdAt?: string; // ISO-8601
  disabledAt?: string; // ISO-8601 if banned, omitted otherwise
  isBot?: boolean;
  isAuthenticated?: boolean;
  scopes?: string[]; // e.g. ["MODERATOR"]
}
```

`user` carries the **full sender identity**, so do per-user state off the stable
`user.id` and gate moderator-only commands on `user.scopes.includes("MODERATOR")`.
Don't match on the display name, which isn't unique or stable. To reply
privately to whoever sent a message, pass `msg` (or `msg.clientId`) to
[`owncast.chat.replyTo`](#replying-to-the-sender).

> `user` is always a `User` object, the same shape on the
> `onChatMessage` event, on the messages returned by
> [`owncast.chat.history()`](#chat-history), and in the dev server. It is
> `undefined` only for the rare message with no associated account.

### Fediverse engagement and raw activity

`onFediverseFollow` receives `{actor}`. `onFediverseLike`, `onFediverseRepost`, and `onFediverseQuote` receive `{actor, target}`. `actor` uses the SDK's `FediverseActor` shape. `target` is `{url: string}`. For a quote, it identifies the locally authored post that the remote actor quoted.

`onFediverse` receives the verified inbound ActivityPub activity after the host validates the HTTP signature and actor origin. In JavaScript, the payload is the raw JSON object. It fires in addition to a specialized handler when one applies. It also fires for verified activity types that have no specialized handler.

Python exposes the same hooks as `@plugin.on_fediverse`, `@plugin.on_fediverse_follow`, `@plugin.on_fediverse_like`, `@plugin.on_fediverse_repost`, `@plugin.on_fediverse_quote`, `@plugin.on_fediverse_mention`, and `@plugin.on_fediverse_reply`. Python notify payloads are non-subscriptable `_Obj` attribute views. Read normal fields as attributes, or use `.raw` for the underlying dictionary and keys that are not valid Python attributes, such as `payload.raw["@context"]`.

### Fediverse inbound posts

`onFediverseMention` and `onFediverseReply` carry a `FediverseInboundPost`. The host accepts these specialized events only from a verified public `Create(Note)` that either mentions the local Fediverse account or replies to a locally authored post:

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

`actor.handle` is the fully-qualified fediverse address (e.g. `@alice@fediverse.example`). Use `contentText` for analysis or display. Use `content` if you need to render the original HTML formatting.

### Filter handlers

`filterChatMessage(msg)` returns one of:

- `filter.pass()`, let the message through unchanged
- `filter.modify(payload)`, replace the message (subsequent filters see your version)
- `filter.drop(reason)`, drop the message, no later filters or notifications see it

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
  user?: User; // the chat user the request came from, when known
}

interface OutgoingHttpResponse {
  status?: number; // default 200
  headers?: Record<string, string>;
  body?: string;
}
```

Endpoints are public by default. Gate admin features with `req.authenticated`.

`req.user` is the chat user the request came from, if Owncast could identify
one. The host resolves it from the visitor's chat identity cookie, which is set
when they register or connect to chat, so it is available on normal viewer
requests such as the page behind an action button. You don't need an access
token in the URL, and you don't do the lookup yourself.

The field is optional. It's set when the request came from a known chat user
and is `undefined` otherwise, so check for it before reading it. Your plugin
never receives the raw access token: the `Cookie` header and any `accessToken`
query parameter are removed from `req.headers` and `req.query` before your
handler runs. The `whoami` example shows the whole flow.

## Owncast APIs

Each method requires the matching permission in your manifest:

| API                                                                             | Requires             |
| ------------------------------------------------------------------------------- | -------------------- |
| `owncast.chat.send(text)`                                                       | `chat.send`          |
| `owncast.chat.sendAction(text)` (italic style)                                  | `chat.send`          |
| `owncast.chat.sendTo(clientId, text)`, private message                          | `chat.send`          |
| `owncast.chat.replyTo(msg, text)`, whisper back to a message's sender           | `chat.send`          |
| `owncast.chat.history(limit?)`, recent messages                                 | `chat.history`       |
| `owncast.chat.clients()`, connected chat clients                                | `chat.history`       |
| `owncast.chat.deleteMessage(messageId)`                                         | `chat.moderate`      |
| `owncast.chat.kick(clientId)`                                                   | `chat.moderate`      |
| `owncast.users.list()` / `.get(id)`                                             | `users.read`         |
| `owncast.users.setEnabled(id, enabled, reason?)`                                | `users.moderate`     |
| `owncast.users.banIP(ip)`                                                       | `users.moderate`     |
| `owncast.users.register({authId, displayName})`, find-or-create a viewer identity | `users.register`  |
| `owncast.auth.grantSession({userId, ttl?})` / `owncast.auth.endSession()`       | `auth.gate`          |
| `owncast.kv.get(key)` / `.set(key, value)` (+ `.getJSON` / `.setJSON`)          | `storage.kv`         |
| `owncast.storage.upload(name, bytes)`, returns `{url}`                          | `storage.upload`     |
| `owncast.fs.read/readText/write/list/delete/exists(...)`, sandboxed disk. `write` and `delete` return `{}` on success or `{error}` on failure. | `storage.fs`         |
| `owncast.sql.exec/query/queryRow(sql, params?)`, private SQLite database        | `storage.sql`        |
| `owncast.http.fetch(url, opts?)`                                                | `network.fetch`      |
| `owncast.events.emit(eventType, payload)`                                       | `events.emit`        |
| `owncast.stream.current()`, live stream state                                   | `server.read`        |
| `owncast.stream.broadcaster()`, inbound encode telemetry (read-only)            | `server.read`        |
| `owncast.server.info()`, server name, version, etc.                             | `server.read`        |
| `owncast.server.socials()`, `[{platform, url, icon}]`                           | `server.read`        |
| `owncast.server.emotes()`, custom chat emotes `[{name, url}]`                    | `server.read`        |
| `owncast.server.federation()`, `{enabled, username, isPrivate}`                 | `server.read`        |
| `owncast.server.tags()`, `[string]`                                             | `server.read`        |
| `owncast.videoConfig.read()`, `{latencyLevel, codec, variants}`                 | `videoconfig.read`   |
| `owncast.videoConfig.write({latencyLevel?, codec?, variants?})`, partial update, throws on failure | `videoconfig.write`  |
| `owncast.notifications.discord(text)`                                           | `notifications.send` |
| `owncast.notifications.browserPush({title, body, url?})`                        | `notifications.send` |
| `owncast.notifications.fediverse({type, body, image?, link?})`                  | `notifications.send` |
| `owncast.fediverse.post(text)`, public post to the fediverse                    | `fediverse.post`     |
| `onHttpRequest` + static files from `public/`                                   | `http.serve`         |
| `owncast.sse.send(channel, event, data)`, push to browsers                      | `http.sse`           |
| `owncast.timer.setTimeout/setInterval/clear(...)`, schedule callbacks           | none (ambient)       |
| `owncast.config.get(key, fallback?)`, read manifest-declared config             | none (ambient)       |

Calling an API without its permission throws a clear error.

### SQL database

`storage.sql` gives your plugin one SQLite database of its own, private to your plugin and separate from Owncast's database. `owncast.sql.exec(sql, params?)` runs statements and reports `rowsAffected` and `lastInsertId`, `owncast.sql.query(sql, params?)` returns rows as objects keyed by column name, and `owncast.sql.queryRow(sql, params?)` returns the first row or `null`. Python is the same API with `query_row` and dicts. A failed statement throws (Python raises). The SDK treats a result object with no `error` field as success and rejects a missing or non-object host response.

Each `exec` call is atomic: a multi-statement batch either commits whole or leaves the database untouched, so a schema migration can't half-apply. You can't hold a transaction open across calls, which also means you never have to clean one up.

`query` never hands you a silently short answer. A query returning more than the row cap, or a result larger than the result budget (see [Limits](#limits)), fails with an error asking for a `LIMIT`. Write the `LIMIT` yourself when a table can grow without bound, and use `queryRow` when you only need one row out of a big table.

Your database has its own size cap, independent of the `storage.fs` quota, so writing files never shrinks the room your tables have, and the other way around. Two things to design around: plugin databases are **not** part of Owncast's database backups, so treat the contents as rebuildable or export what matters yourself, and the data is kept when an admin uninstalls your plugin, exactly like your config and your `storage.fs` files, so a reinstall finds its tables where it left them. An admin who wants the space back deletes one directory, `data/plugin-storage/<slug>/`, which holds both your database and your `storage.fs` files.

Ordinary SQL is all available: DDL, DML, indexes, views, triggers, `ORDER BY`, recursive CTEs, subqueries, `UNION`, and the json1 functions. Refused in every host: `ATTACH`, `DETACH`, every `PRAGMA` (reads included), temporary-schema DDL both as keywords (`CREATE TEMP TABLE` / `INDEX` / `TRIGGER` / `VIEW`) and schema-qualified (`CREATE TABLE temp.x`), `load_extension()`, `VACUUM` and `VACUUM INTO`, and transaction controls (`BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, and `RELEASE`). Each `exec` call already owns the transaction around the whole batch.

`owncast-plugin-test` and `owncast-plugin-serve` give your plugin a real SQLite database, so you can develop and test against `owncast.sql` without a running Owncast. It is in-memory, so every scenario and every restart of the dev server starts clean. Every limit and every refusal above applies there too, including the statements listed in the previous paragraph, so a passing scenario test means the same SQL is accepted on a real server.

A worked example ships with the SDK: `examples/js/chat-leaderboard` and
`examples/python/chat-leaderboard` rank chatters by message count, covering
schema creation in one atomic `exec`, an `ON CONFLICT` upsert, a bounded ranked
`query`, and a single-row read.

> **JavaScript integers.** Parameters and results cross the host boundary as JSON. Python can bind and read exact 64-bit SQLite integers. JavaScript loses unsafe integers before `JSON.stringify` on writes and during `JSON.parse` on reads. Store values above `Number.MAX_SAFE_INTEGER` (2^53 - 1) as TEXT when a JavaScript plugin needs them to remain exact.

### Chat identity

Every plugin has **exactly one chat identity**, the auto-bot Owncast provisions when your plugin is installed. The display name is your plugin's `name` (e.g. `echo-bot`), with `IsBot: true`. `owncast.chat.send(text)` and `owncast.chat.sendAction(text)` both post as this identity, through Owncast's normal chat pipeline (filters, rate limits, persistence, moderation, same as any user).

> **Text is HTML-escaped on display.** `owncast.chat.send`/`sendAction` take plain text, and the chat client renders it as HTML, so characters like `"`, `<`, and `&` come back entity-encoded (`"Live"` displays via `&#34;Live&#34;`). That's expected, so don't pass markup expecting it to render. `owncast.chat.system(body)` is the exception: its body **is** rendered as HTML, so you must escape any untrusted content you put in it yourself.

If you need multiple chat personas, **ship multiple plugins.** One identity per plugin keeps the trust boundary clear: admins see one chat user per granted plugin, and there's no allowlist machinery to forget or bypass. Plugins cannot post under arbitrary names or impersonate real users.

### Replying to the sender

A chat message carries the sender's `clientId`, so to whisper a confirmation,
cooldown, or usage notice privately back to whoever ran a command, pass the
message straight to `owncast.chat.replyTo`:

```js
filterChatMessage(msg) {
  if (onCooldown(msg.user?.id)) {
    // replyTo returns false if the sender's connection is gone; fall back to public.
    if (!owncast.chat.replyTo(msg, "slow down, try again in a few seconds")) {
      owncast.chat.send("slow down, try again in a few seconds");
    }
    return filter.drop("cooldown");
  }
  return filter.pass();
}
```

`replyTo(msg, text)` is sugar over `sendTo(msg.clientId, text)`. Pass a bare
`clientId` if that's all you have.

### Commands and `!help`

Declare a command table instead of parsing every chat message yourself. Command
tables support aliases, parsed arguments, moderator gates, and per-user
cooldowns:

```js
const { definePlugin } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  commandPrefix: "!", // optional, default "!"
  commands: {
    uptime: {
      description: "How long we've been live",
      run: (ctx) => ctx.reply("we've been live a while!"),
    },
    so: {
      description: "Shout out a viewer",
      usage: "!so <name>",
      aliases: ["shoutout"],
      cooldownMs: 10_000,
      run: (ctx) => ctx.reply(`go follow ${ctx.args[0] || "someone cool"}`),
    },
    clear: {
      description: "Clear the chat",
      modOnly: true,
      run: (ctx) => ctx.replyPrivately("done"),
    },
  },
});
```

Each `run(ctx)` receives
`{ msg, user, command, invokedAs, args, argString, reply, replyPrivately }`.
`command` is the canonical declaration. `invokedAs` is the name or alias the
sender typed. `reply` posts publicly and `replyPrivately` whispers to the
sender.

Python uses the same core behavior through `plugin.commands(...)`:

```python
from owncast_plugin import plugin

plugin.commands({
    "uptime": {
        "description": "How long we've been live",
        "run": lambda ctx: ctx.reply("we've been live a while!"),
    },
    "so": {
        "aliases": ["shoutout"],
        "cooldown_ms": 10_000,
        "run": lambda ctx: ctx.reply(
            f"go follow {ctx.args[0] if ctx.args else 'someone cool'}"
        ),
    },
})
```

Command behavior:

- Duplicate commands are allowed. Every matching plugin runs.
- Unknown commands produce no response.
- Non-moderators do not invoke `modOnly` commands.
- Cooldown-limited invocations produce no response.
- Command messages remain ordinary chat messages. A separate
  `onChatMessage` or `@plugin.on_chat_message` handler still receives them.
- Chat filters run first. A filtered-out message cannot execute a command.

No permission is required to declare or receive a command. The handler still
needs the permission for each action it performs, such as `chat.send`,
`chat.moderate`, or `network.fetch`.

#### `!help` is automatic but not reserved

Owncast posts an aggregated command list for `!help` and its `!commands` alias.
The message remains ordinary chat, and plugins may also declare or respond to
either command. The built-in response does not block additional plugin
responses. `modOnly` commands are hidden from non-moderators.

#### Hand-rolling a fixed command

For a single fixed command, checking `msg.body` in `onChatMessage` is still
valid. See the `ip-bot` and `relay` examples. Hand-rolled commands do not appear
in the built-in help listing.

## Permissions

| Permission           | Grants                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.send`          | `owncast.chat.send`, `.sendAction`, `.sendTo`                                                                                                     |
| `chat.history`       | `owncast.chat.history`, `.clients`                                                                                                                |
| `chat.moderate`      | `owncast.chat.deleteMessage`, `.kick`                                                                                                             |
| `chat.filter`        | Subscribe to `filterChatMessage` (read, modify, or drop every chat message). Required for any plugin that declares the handler.                   |
| `users.read`         | `owncast.users.list`, `.get`                                                                                                                      |
| `users.moderate`     | `owncast.users.setEnabled`, `.banIP`                                                                                                              |
| `users.register`     | `owncast.users.register`, find-or-create an authenticated Owncast user for an external identity. The host records your slug alongside the raw `authId` and scopes every lookup to that pair, so plugins can't collide on or impersonate each other's users. |
| `auth.gate`          | Be the site's viewer-authentication gate: `owncast.auth.grantSession` / `.endSession` plus the `onAuthCheck` hook. Only one gate plugin can be enabled at a time. See [Viewer authentication gates](#viewer-authentication-gates). |
| `storage.kv`         | Per-plugin namespaced key/value store                                                                                                             |
| `storage.upload`     | `owncast.storage.upload`, upload files, get a public URL                                                                                          |
| `storage.fs`         | `owncast.fs.*`, private sandboxed disk under `data/plugin-storage/<slug>/files/` (server-side only, never served over HTTP). `write` and `delete` return `{}` on success or `{error}` on failure. |
| `storage.sql`        | `owncast.sql.*`, private per-plugin SQLite database under `data/plugin-storage/<slug>/db/`, separate from the `storage.fs` sandbox and not included in Owncast backups |
| `network.fetch`      | Outbound HTTP, also requires `network.allowedHosts` (see below)                                                                                   |
| `events.emit`        | Emit custom events for other plugins to subscribe to                                                                                              |
| `http.serve`         | Serve HTTP at `/plugins/<your-name>/*`                                                                                                            |
| `http.sse`           | Push realtime events to browsers via `owncast.sse.send` + the `/_sse/` endpoint                                                                   |
| `server.read`        | Read stream state, server config, and read-only broadcast telemetry (`stream.broadcaster`)                                                        |
| `videoconfig.read`   | `owncast.videoConfig.read()`, read the output/transcoding config                                                                                  |
| `videoconfig.write`  | `owncast.videoConfig.write()`, change video config, high-trust. Changes apply on the next stream start (the host does not restart a live stream). |
| `notifications.send` | `owncast.notifications.discord`, `.browserPush`                                                                                                   |
| `fediverse.inbound`  | Subscribe to `fediverse.activity`, `fediverse.follow`, `fediverse.like`, `fediverse.repost`, `fediverse.quote`, `fediverse.mention`, and `fediverse.reply` through `onFediverse` and the six specialized handlers. Required for any plugin that declares one of those handlers. |
| `fediverse.post`     | `owncast.fediverse.post(text)`, high-trust (posts under the streamer's handle), admin should grant sparingly.                                       |
| `ui.modify`          | Place UI inside Owncast's own chrome. Required for `manifest.actions`, `manifest.styles`, `manifest.scripts`, and `manifest.extraPageContent`.    |

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

Entries are hostname globs, bare hostnames match exactly. `*` is a wildcard segment. The wildcard `"*"` matches any host but **must be written explicitly** (`"network": { "allowedHosts": ["*"] }`) so admins reviewing the manifest see the scope they're granting. Most plugins should list the specific hosts they actually call.

## Limits

The host enforces these caps per plugin. They're generous for normal use. Size pages, APIs, and JSON payloads against them so you don't get truncated or timed out.

| Limit | Value | Applies to |
| --- | --- | --- |
| Wasm linear memory | 64 MiB | the whole plugin instance |
| `on_filter` (chat filter) runtime | 50 ms | each `filterChatMessage` call |
| `on_event` (notification) runtime | 500 ms | each event handler (`onChatMessage`, `onStreamStarted`, `onTick`, …) |
| `on_http_request` runtime | 5 s | each HTTP handler call |
| Hard per-call ceiling | 10 s | any single export call (backstop above the above) |
| `register()` output | 256 KiB | the subscription/manifest JSON your build emits |
| `on_filter` output | 1 MiB | the (modified) message a filter returns |
| HTTP request body delivered to your handler | 1 MB | inbound `onHttpRequest` body |
| HTTP response body | 10 MB | what `onHttpRequest` returns |
| `on_http_request` envelope output | 12 MiB | the full encoded response envelope |
| Pending timers | 64 | `owncast.timer.setTimeout`/`setInterval` outstanding at once |
| Timer delay | 100 ms to 24 h | clamped into this range |
| SSE connections | 64 | concurrent browser clients on your event stream |
| `storage.fs` footprint | 256 MiB | every file your plugin writes through `owncast.fs.*` |
| `storage.sql` database | 128 MiB | your whole SQLite database, counted separately from `storage.fs` |
| SQL request | 64 KiB | one `owncast.sql` call, statement text plus parameters |
| SQL bound parameters | 64 | `params` in one `owncast.sql` call |
| SQL column value | 1 MiB | a single value in a returned row |
| SQL query result | 1 MiB | the whole encoded result of one `query` |
| SQL rows returned | 10000 | one `query`, and passing it is an error rather than a truncated result |
| SQL call runtime | 2 s | each `exec` or `query` |

`owncast.kv` values have no hard size cap, but it's a config/state store, not a blob store, so keep values small (use `storage.upload` or `storage.fs` for large data). Timeouts mean a handler that blocks (a slow `owncast.http.fetch`, a tight loop) is cancelled, so keep event/filter work quick and push slow work elsewhere.

## Serving HTTP

Anything in your `public/` directory is served at `/plugins/<your-name>/...`. Requests that don't match a file fall through to your `onHttpRequest` handler. The separate `assets/` directory holds files the host reads internally for manifest-inlined content (`styles`, `scripts`, `extraPageContent`) and is never reachable through the plugin's URL space.

> **Host-version note.** `public/`-as-web-root is the current convention and what every Owncast host from the 0.4.x line onward serves. The standalone `owncast-plugin-serve` **v0.4.0** release binary predates it and serves static files from `assets/` instead, so a plugin authored per these docs (pages in `public/`) shows 404s for its pages on that one older binary. If you must support it, bundle the same files under both directories (for example an `assets/` to `public/` symlink). Newer hosts and the bundled dev server (`owncast-plugin serve`) serve `public/` directly, so this only affects that specific downloadable binary.

```
my-plugin/
└── public/
    ├── index.html        → /plugins/my-plugin/index.html (and /plugins/my-plugin/)
    └── style.css         → /plugins/my-plugin/style.css
```

A request to `/plugins/my-plugin/` serves `public/index.html` automatically.

For dynamic endpoints (JSON APIs, webhooks, etc.) write an `onHttpRequest`. Path traversal is blocked, response headers are filtered through an allowlist (allowed: `Content-Type`, `Cache-Control`, `Set-Cookie`, `Location`, `ETag`, `Last-Modified`, `Vary`, `Link`, and CORS headers, with host-owned things like `Server`, CSP, and HSTS blocked), and body sizes are capped at 1 MB request / 10 MB response. Cookies you set default to a `Path` scoped to your plugin's namespace.

## Realtime updates (Server-Sent Events)

For pushing live updates to a browser, an overlay that reacts to chat, a dashboard that ticks viewer counts, an alert widget, declare `http.sse` and use `owncast.sse.send`.

You do **not** open or hold the connection yourself. Your `onHttpRequest` handler can't stream: each call is a single buffered request/response. Instead, the host owns the long-lived connection and exposes a ready-made endpoint at `/plugins/<your-slug>/_sse/<channel>`. Your plugin just pushes. The host fans each message out to every connected browser.

**Plugin side**, push whenever you have something to send (from an event handler, an HTTP handler, anywhere):

```js
// src/plugin.js
export function onChatMessage(msg) {
  // Notify every browser watching the "overlay" stream.
  owncast.sse.send("overlay", "chat", {
    from: msg.user?.displayName,
    body: msg.body,
  });
}
```

`send(channel, event, data)`:

- `channel`, which stream to push to. Browsers subscribe per channel, so you can run several independent streams (`"overlay"`, `"admin-stats"`) from one plugin. Use `""` for a single default channel.
- `event`, the event name the browser listens for (`addEventListener("chat", …)`). Pass `""` for the browser's default `message` event.
- `data`, the payload. Strings are sent as-is, anything else is JSON-encoded for you.

Sends are fire-and-forget: the call returns immediately and never blocks, even if no one is connected or a client is slow (slow clients drop frames rather than stall your plugin).

**Browser side**, connect with the standard `EventSource` API, no library needed:

```html
<!-- public/index.html, served at /plugins/my-plugin/ -->
<script>
  const events = new EventSource("/plugins/my-plugin/_sse/overlay");
  events.addEventListener("chat", (e) => {
    const { from, body } = JSON.parse(e.data);
    document.getElementById("feed").textContent = `${from}: ${body}`;
  });
</script>
```

Notes:

- Up to 64 simultaneous connections per plugin. Over that the endpoint returns 503. `EventSource` reconnects automatically.
- If the channel matches one of your `admin.pages` path globs, it is auth-gated like any admin route. This is useful for an admin-only stats stream.
- The endpoint is host-owned and reserved: your `onHttpRequest` never sees `/_sse/...` requests, and you can't serve your own route there.

### Knowing who is connected

When you declare `http.sse`, the host tells you whenever a browser opens or closes one of your streams, so you can track who's connected:

```js
const present = new Map(); // connectionId -> user (or undefined)

definePlugin({
  onSseConnect({ channel, connectionId, user }) {
    present.set(connectionId, user); // user is undefined for anonymous viewers
  },
  onSseDisconnect({ connectionId }) {
    present.delete(connectionId);
  },
});
```

The host resolves the connecting chat user from their identity cookie, the same `user` shape your HTTP handlers get on `req.user`, and it's omitted when the viewer hasn't joined chat. `connectionId` is unique per connection, so a disconnect pairs with its connect and one user open in several tabs counts as several connections. These arrive on the normal event path (no extra permission beyond `http.sse`), and a connect/disconnect you don't handle is ignored.

## Timers and the tick

There is no `setTimeout` in the sandbox: a handler runs to completion and then your plugin is idle until the host calls it again, so nothing can run "later" on its own. Two host-driven mechanisms cover delayed and periodic work. Neither needs a permission.

`owncast.timer` schedules a callback the host runs for you later, in this same instance:

```js
// Send a message 30 seconds from now:
const id = owncast.timer.setTimeout(() => owncast.chat.send("starting now!"), 30_000);

// Repeat until cleared:
const ping = owncast.timer.setInterval(() => owncast.chat.send("still live"), 60_000);

owncast.timer.clear(id); // cancel either kind
```

`setTimeout`/`setInterval` return an id for `clear()`. Very small delays are clamped up by the host, there's a per-plugin cap on pending timers (scheduling past it throws), and an interval's next run is scheduled only after the previous one returns, so a slow callback can't pile up. **Timers are in-memory: they do not survive a plugin reload or a host restart.** For "remind me even if Owncast restarts" you'd persist the target time yourself (e.g. in `storage.kv`) and re-arm on load.

`onTick({ now })` fires once a second for open-ended periodic work. Define it to opt in. `now` is the host wall-clock time in unix milliseconds.

```js
definePlugin({
  onTick({ now }) {
    // runs every ~1s while the plugin is enabled
  },
});
```

### Telling the time

`Date` works normally for formatting and arithmetic, and the clock is real: `Date.now()` and `new Date()` return the actual current time, and `performance.now()` is a real monotonic clock. (`onTick`/timer payloads also carry the host time, handy if you don't want to call `Date` yourself.) `setTimeout`/`setInterval` as JS globals do **not** exist, use `owncast.timer` instead.

## Config

Declare admin-configurable settings under `config` in the manifest, each with a
type, a default, and a description:

```json
{
  "config": {
    "greeting": { "type": "string", "default": "welcome!", "description": "First-join message" },
    "cooldownMs": { "type": "number", "default": 2000, "description": "Per-user command cooldown" },
    "modOnly": { "type": "boolean", "default": false, "description": "Restrict to moderators" }
  }
}
```

Read them from plugin code with `owncast.config.get(key)`, which returns the
admin-set value when present and the declared default otherwise, already parsed
to the declared type:

```js
const cooldown = owncast.config.get("cooldownMs"); // number, e.g. 2000
const greeting = owncast.config.get("greeting", "hi"); // 2nd arg is a fallback for unknown keys
```

`config.get` is ambient (no permission). Reading an undeclared key returns the
`fallback` (or `undefined`). This is the recommended way to expose simple knobs.
Prefer it over building a bespoke settings page and KV plumbing.

## Admin pages

Plugins can register pages that appear in the Owncast admin UI for configuration. Each `pages` object key is a plugin-relative path glob:

```json
{
  "permissions": ["http.serve"],
  "admin": {
    "pages": {
      "/admin": { "title": "Settings", "icon": "gear" },
      "/admin/*": { "title": "Settings" }
    }
  }
}
```

- Each key is a path glob such as `"/admin"` or `"/admin/*"`. Requests under `/plugins/<your-slug>/<path>` that match any declared glob are **auth-gated by the host**. Unauthenticated requests get `401` before your plugin code runs.
- Owncast's admin renders each declared page as a tab inside `/admin/plugins/configure?id=<your-slug>`, embedded as an iframe pointed at `/plugins/<your-slug>/<path>`. Each plugin gets its own bookmarkable URL plus a sidebar entry under **Plugins** in the admin nav.
- Both static assets and dynamic endpoints under matched paths are auth-gated. You don't have to check `req.authenticated` yourself.
- The host auto-injects an admin-themed stylesheet (`/styles/admin/plugin-iframe.css`) into HTML responses on admin paths so plain `<input>` and `<button>` controls match Owncast's look without you needing to ship CSS. Plugins that prefer their own styling can layer on top.
- The iframe is sandboxed but permits what an admin page normally needs: your scripts, form submits, same-origin `fetch` to your own endpoints, popups, **file downloads** (a blob/data-URL `<a download>` clicked from script), and **`confirm()`/`alert()`/`prompt()`** dialogs. If a browser feature seems silently blocked, suspect the iframe sandbox first.
- JSON object order is not significant. Owncast displays pages in lexicographic path order.

Author flow:

1. Put admin HTML, CSS, and JavaScript in `public/admin/index.html` and related files.
2. Expose admin APIs via `onHttpRequest` at `/admin/api/...`.
3. Declare both path keys, or just `"/admin/*"`, in `manifest.admin.pages`.
4. Visit `/admin/plugins/configure?id=<your-slug>` in the admin UI or `/plugins/<your-slug>/admin/` directly. Owncast uses your existing admin login to gate the page. No extra prompt.

## Viewer authentication gates

A plugin holding the `auth.gate` permission can become the site's login wall. The plugin renders the login flow and decides who gets in. The host owns the signed session cookie end to end, so your code never sees it. Only one `auth.gate` plugin can be enabled at a time.

The flow (see `examples/js/github-auth` for a complete OAuth version):

1. An unauthenticated visitor requests any page. The host redirects them to your plugin's index at `/plugins/<slug>/?return_to=<original path>`.
2. Your `onHttpRequest` renders a login screen and runs whatever proves the visitor's identity and entitlement: an OAuth round-trip with a provider, a lookup against a webhook-maintained member list, etc.
3. Once satisfied, name the visitor and grant the session:

```js
const { userId } = owncast.users.register({ authId: "provider:1234", displayName: "Jo" });
owncast.auth.grantSession({ userId }); // the host attaches the cookie to this response
return { status: 302, headers: { Location: returnTo } };
```

4. For logout, call `owncast.auth.endSession()` and redirect.

`users.register` finds-or-creates an authenticated Owncast user for an external identity (the host scopes the identity to your slug, so pass the raw external id unprefixed). `grantSession`/`endSession` are only meaningful inside `onHttpRequest`, where the host attaches or clears the cookie on the response after your handler returns.

### Re-validating sessions: `onAuthCheck`

Define `onAuthCheck(req)` to re-validate a session whenever a signed-in viewer loads the main page. This is how a gate notices lapsed memberships without needing webhooks:

```js
onAuthCheck(req) {
  // req.user is the host-resolved viewer identity (same shape as onHttpRequest's req.user)
  return stillEntitled(req.user.id) ? authCheck.ok() : authCheck.deny();
}
```

Return `authCheck.ok()`, `authCheck.deny()` (the host clears the session and bounces the viewer to your login screen), or `authCheck.refresh({ ttl? })` (keep the session and re-issue the cookie for sliding expiry). Errors fail closed, as a deny.

### Access policy is the operator's, not yours

The admin UI adds an **Authentication** tab for every installed plugin that
declares `auth.gate`. The operator selects one host-owned access mode stored
per plugin:

| Access mode | Effect |
| --- | --- |
| Website only (default) | The web interface requires sign-in. `/hls/*`, `/api/status`, and directory listing stay public. |
| Website, video players, and other resources | Also gates `/hls/*`. Players such as VLC cannot complete the browser login. `/api/status` and directory listing stay public. |
| Website, video players, and server status requests | Gates the web interface, `/hls/*`, and `/api/status`. Directory listing is disabled. |

The modes are cumulative. A plugin cannot read or change the selected mode.
Write your plugin against the default. Do not assume a viewer reaching
`/hls/*` has a session, and do not build features that depend on `/api/status`
being private. A viewer with a valid session is let through regardless of the
selected mode.

Gate-specific things to know:

- `req.user` carries no external identity. Store your own mapping at registration time (`owncast.kv.set("member:" + userId, externalId)`) and look it up in `onAuthCheck`.
- Use a stable external id in `authId` (a numeric account id), never a username or email that can change.
- Your own routes stay reachable through the gate — visitors must be able to reach the login screen — which also means inbound webhooks to `/plugins/<slug>/...` keep working while the gate is up. `/admin` is likewise exempt, so an admin can always fix or disable a misconfigured gate.
- Fail closed while unconfigured: refuse to grant sessions until your config values are set.
- Testing: the `authCheck` scenario step drives `onAuthCheck` directly (see [Step types](#step-types)).

## Action buttons

Owncast surfaces a row of "external action" buttons in its UI, clickable entries that either open a URL (in a modal or new tab) or render raw HTML. Plugins can contribute their own. While the plugin is enabled, the host merges its action entries into the list Owncast already shows. When disabled, they disappear.

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
- **Per-button icons** (`icon` field) follow the same rules as `url`. A relative path like `"/star.png"` auto-prefixes to `/plugins/my-plugin/star.png`, so ship the image under `public/` and `http.serve` will route it. Absolute `https://cdn.example.com/...` URLs pass through unchanged (use these for external icons that don't need `http.serve`). Cross-plugin icon paths are rejected just like cross-plugin URLs.

This pairs naturally with `http.serve`: ship a UI under `public/` and declare an action button that opens it.

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

A common pattern is an admin page that lets the streamer add a custom button (label + URL) on top of the plugin's defaults. The `action-buttons` example in the SDK ships a working version.

## Viewer-page injection

Three manifest fields let a plugin contribute content directly to the viewer page: CSS, JavaScript, and a block of HTML. The host inlines plugin contributions into the same response slots Owncast already uses for the admin's custom CSS, custom JS, and extra page content, so a viewer loads one stylesheet, one script, and one extra-content block regardless of how many plugins contributed.

| Manifest field     | Inlined into                          | Required permission | Notes              |
| ------------------ | ------------------------------------- | ------------------- | ------------------ |
| `styles`           | `/api/config` → `customStyles`        | `ui.modify`         | must end `.css`    |
| `scripts`          | `/customjavascript`                   | `ui.modify`         | must end `.js`     |
| `extraPageContent` | `/api/config` → `extraPageContent`    | `ui.modify`         | static or dynamic  |

Each also has a **dynamic** form computed at request time by a handler instead of a static file. `extraPageContent` uses `onPageContent` (below). CSS and JavaScript use the `onPageStyles` and `onPageScripts` handlers, which need no manifest entry at all. The host calls them once per `/api/config` for any plugin holding `ui.modify`, and a plugin opts in by exporting the handler. Their output lands in the same `customStyles` / `/customjavascript` slots, appended after any static `styles` / `scripts` contributions.

### Stylesheets

```json
{
  "permissions": ["ui.modify"],
  "styles": ["theme.css", "overrides.css"]
}
```

Bundle the CSS files under `assets/` and reference them by path. The host strips the plugin prefix, reads each file's bytes, and concatenates them in front of a `/* plugin: <slug> — <file> */` delimiter so a reader can attribute a rule back to whichever plugin shipped it. Disabling the plugin drops its contribution.

Path rules match action-button URLs:

* Bare `"theme.css"` and single-slash `"/theme.css"` resolve to `/plugins/<slug>/theme.css`.
* Fully qualified `/plugins/<slug>/...` paths pass through.
* Paths in another plugin's namespace, `http(s)://` URLs, or non-`.css` extensions are rejected at load.

Relative `url(...)` references inside the CSS resolve against the viewer page, not against the plugin's namespace. Use an absolute path like `/plugins/<slug>/logo.png` when referencing bundled images or fonts.

### Dynamic stylesheets

When the CSS depends on plugin state, like a theme the admin selected or a value in the KV store, return it from `onPageStyles` instead of (or in addition to) shipping a static file. No manifest field is involved. Export the handler and declare `ui.modify`.

```js
module.exports = definePlugin({
  onPageStyles() {
    const theme = owncast.kv.get("theme");           // e.g. "midnight"
    if (!theme) return "";                            // contribute nothing
    return `:root { --theme-color-action: ${accentFor(theme)}; }`;
  },
});
```

The returned string is appended to `customStyles` after any static `styles` files (so a later rule wins the cascade), preceded by a `/* plugin: <slug> — dynamic */` delimiter. The call is global. It takes no per-viewer argument, which keeps `/api/config` cacheable. Return `""` to contribute nothing on this request. Python exposes the same hook as the bare decorator `@plugin.on_page_styles`.

### Scripts

```json
{
  "permissions": ["ui.modify"],
  "scripts": ["client.js"]
}
```

Same path and permission rules as `styles`, applied to `.js` files. The host prefixes each contribution with `// plugin: <slug> — <file>`.

Two things to keep in mind about execution:

* Every plugin's script runs in the viewer page's window, sharing the global scope with the admin's customJavascript and every other plugin. Wrap your script in an IIFE so top-level declarations don't collide.
* The host wraps each plugin's contribution in its own `try`/`catch`, so a **runtime** error throws to the browser console (`owncast plugin <slug> script error:`) without aborting other plugins' scripts. A **syntax** error is not isolated. It fails to parse the shared bundle before any `try` runs, so still ship valid JS.

### Dynamic scripts

The script counterpart to `onPageStyles`: return JavaScript computed at request time from `onPageScripts`. No manifest field is involved. Export the handler and declare `ui.modify`.

```js
module.exports = definePlugin({
  onPageScripts() {
    const theme = owncast.kv.get("theme");
    if (!theme) return "";
    return `(function () { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; })();`;
  },
});
```

The return is appended to `/customjavascript` after any static `scripts`, wrapped in the same per-plugin `try`/`catch`, and runs in the shared viewer `window`, so the IIFE and escaping advice above applies. The call is global (no per-viewer argument). Python exposes it as `@plugin.on_page_scripts`.

### Extra page content

`extraPageContent` is an object with a required `slug` and an optional `content` file:

```json
{
  "permissions": ["ui.modify"],
  "extraPageContent": { "slug": "banner", "content": "content.html" }
}
```

**Static** (`content` present): the host reads the file from `assets/` and inlines it at the top of the viewer's extra-content block, above whatever the admin has configured. Path rules match `styles` and `scripts` but the entry has to end in `.html`. `http.serve` is not required.

**Dynamic** (`content` absent): the host calls `onPageContent({ slug, user? })` at `/api/config` time and inlines the returned HTML string. `user` is the requesting viewer's chat identity when available.

```js
module.exports = definePlugin({
  onPageContent({ slug, user }) {
    if (slug === "banner") {
      const name = user?.displayName ?? "visitor";
      return `<aside>Welcome, ${name}!</aside>`;
    }
    return "";
  },
});
```

The admin's extra page content goes through the markdown processor, but plugin HTML does not. Tags and attributes pass through as written, so escape any untrusted strings you embed.

## Viewer-page tabs

Plugins can add tabs to the viewer page's tab row alongside the built-in **About** and **Followers** tabs with `manifest.tabs`. Each object key is the tab slug. Every value requires a `title`, and `content` is optional:

```json
{
  "permissions": ["ui.modify"],
  "tabs": {
    "music": { "title": "Music", "content": "music.html" },
    "stream-info": { "title": "Stream Info" }
  }
}
```

- Each key is the tab's required stable slug. It must be unique within the plugin and use lowercase letters, digits, and hyphens. Owncast passes it to `onTabContent` so the handler knows which tab to render.
- `title`: required. The label shown on the tab. Keep it short, around 16 characters maximum for mobile.
- `content`: optional. Relative path to a static HTML file in `assets/`. When omitted, the host calls `onTabContent`.
- JSON object order is not significant. Owncast displays tabs in lexicographic slug order.

**Static** (`content` present): the host reads the file from `assets/` and inlines it as the tab body. Path rules match `extraPageContent.content`.

**Dynamic** (`content` absent): the host calls `onTabContent({ slug, user? })` and inlines the returned HTML string.

```js
module.exports = definePlugin({
  onTabContent({ slug, user }) {
    if (slug === "stream-info") {
      const stream = owncast.stream.current();
      return stream.online
        ? `<p>Live: ${stream.title} (${stream.viewers} viewers)</p>`
        : `<p>Offline</p>`;
    }
    return "";
  },
});
```

Requires `ui.modify`. `http.serve` is not required, because the host inlines the result and nothing is served at a URL. Add whatever data permissions (`server.read`, `chat.history`, etc.) your handler actually calls.

The `tabs-demo` example ships two static tabs. `page-content-demo` demonstrates dynamic rendering with Mustache templates and `server.read` data.

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

Before any scenario runs, the test runner load-checks the plugin: the same
install-time path a real Owncast server runs, covering manifest validity, a
healthy `register()`, and permission-gated subscriptions (a chat filter
without `chat.filter`, or a fediverse handler without `fediverse.inbound`,
fails right there with the same error the server gives at install). The check
runs even when a plugin ships no tests, and `package` runs it too — a plugin
that would be rejected at install refuses to package.

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

`npm test` builds your plugin (bundling `src/plugin.{js,ts}` into `<slug>.js`), then runs `node __tests__/*.test.js`. Each scenario is a `{ name, given?, events, expect? }` object, the same data model as a JSON scenario file, but in JS you can build the array with loops, helpers, fixtures, or computed payloads.

If you prefer raw JSON, drop `__tests__/*.test.json` files in instead and invoke the runner with `owncast-plugin test`. The data model is identical, and the host binary that runs them is the same. Pick whichever is easier to read for the scenarios you're writing.

`runScenarios` no longer exits the process. It sets `process.exitCode` on failure and returns a boolean, so you can split scenarios across several `__tests__/*.test.js` files (by module or feature) and run them all in one node process with `runScenarioFiles()`:

```js
// __tests__/index.test.js
const { runScenarioFiles } = require("@owncast/plugin-sdk/testing");
runScenarioFiles(); // discovers and runs the sibling *.test.js files, aggregating pass/fail
```

Point your `test` script at that one entry (`node __tests__/index.test.js`) instead of looping over files in the shell.

### Step types

- `event: "<type>"`, fire-and-forget notification dispatch
- `filter: "<type>"`, filter chain. Inline `expect: {action, payload?, reason?}` checks the FilterResult
- `http: { method, path, headers?, body?, user?, authenticated?, expect: {status, headers?, body?, bodyContains?} }`, sends an HTTP request through your plugin server
- `tabContent: { slug, user?, expect: {body?, bodyContains?} }`, calls `onTabContent` directly and asserts on the returned HTML
- `pageContent: { slug, user?, expect: {body?, bodyContains?} }`, calls `onPageContent` directly and asserts on the returned HTML
- `pageStyles: { expect: {body?, bodyContains?} }`, calls `onPageStyles` directly and asserts on the returned CSS
- `pageScripts: { expect: {body?, bodyContains?} }`, calls `onPageScripts` directly and asserts on the returned JavaScript
- `authCheck: { user: {...}, expect: {action: "ok" | "refresh" | "deny", reason?} }`, calls `onAuthCheck` with a resolved viewer identity and asserts the verdict (for `auth.gate` plugins)

```json
[
  {
    "name": "stream-info tab renders live title",
    "given": { "stream": { "online": true, "title": "Friday Night", "viewers": 12 } },
    "events": [
      {
        "tabContent": {
          "slug": "stream-info",
          "expect": { "bodyContains": "Friday Night" }
        }
      }
    ]
  },
  {
    "name": "banner greets authenticated viewer by name",
    "events": [
      {
        "pageContent": {
          "slug": "banner",
          "user": { "id": "u1", "displayName": "Alice" },
          "expect": { "bodyContains": "Alice" }
        }
      }
    ]
  }
]
```

### Assertions

Per-step `expect` (on filter and http steps):

- For filters: `action: "pass" | "modify" | "drop"`, `payload`, `reason`
- For HTTP: `status`, `headers`, `body`

Final-state `expect` (on the whole scenario):

- `chatSends`, `chatActions`, `chatSystems`, exact-match lists of chat posts (the bot-sent, "/me" action, and system message variants). Captures sends from any step, including chat posted from an `onHttpRequest` handler.
- `chatTo`, list of `{clientId, text}` private replies (`owncast.chat.sendTo` / `replyTo`)
- `sseSends`, ordered list of `{channel, event?, data?}` pushed via `owncast.sse.send` (omit `event`/`data` to match only on channel)
- `videoConfigWrites`, list of partial configs applied via `owncast.videoConfig.write()`
- `emits`, list of `{eventType, payload}` for custom events
- `kv`, partial map of your plugin's key/value store after the scenario
- `httpRequests`, outbound HTTP made by your plugin

### Seeding state with `given`

- `given.kv`, pre-populate your plugin's key/value store (what `owncast.kv.get` reads)
- `given.config`, admin-set overrides for manifest-declared config keys, e.g. `"given": { "config": { "cooldownMs": 500 } }`. `owncast.config.get` returns the override instead of the declared default. Only keys declared under `config` in the manifest are visible to the plugin.
- `given.stream`, what `owncast.stream.current()` returns
- `given.broadcaster`, what `owncast.stream.broadcaster()` returns
- `given.server`, what `owncast.server.info()` returns
- `given.socials` / `given.federation` / `given.tags`, what the matching `owncast.server.*` reads return
- `given.videoConfig`, what `owncast.videoConfig.read()` returns
- `given.chatHistory`, what `owncast.chat.history()` returns
- `given.chatClients`, what `owncast.chat.clients()` returns
- `given.users`, what `owncast.users.list()` / `.get(id)` returns
- `given.httpResponses`, canned responses for outbound `owncast.http.fetch` calls. Each entry's `url` is a glob matched against the full URL (`"https://api.example.com/user*"` covers any query string) and the first matching entry wins. One canned response per pattern: a sequence where the same URL must answer differently across calls (e.g. 401, then 200 after a token refresh) can't be modeled, so unit-test that branch outside the runner.

Without `given.config`, config reads return the manifest-declared defaults (exactly like a production host where the admin hasn't edited the settings). Test both paths: an override scenario and a defaults/unconfigured scenario.

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

Without either flag, requests are treated as unauthenticated. Requests to manifest-declared admin paths return 401.

## Local dev server

```sh
npm run serve
```

Loads your plugin and serves it on `http://localhost:8080/plugins/<your-name>/`. Useful for browser-testing static pages and curl-ing HTTP endpoints. Override the port with `PORT=8765 npm run serve`.

It also exposes dev-only endpoints to drive your event and filter handlers (which a plain HTTP server can't reach), and host reads (server info, video config, etc.) return sample dev data:

- `POST /_dev/chat` with `{"user":"alice","body":"hi"}`, runs your `filterChatMessage` chain, then fires `chat.message.received` (`onChatMessage`). The JSON response shows what your filter did.
- `GET /_dev/chat`, the chat log so far, including anything your plugin posted.
- `POST /_dev/event` with `{"type":"stream.started","payload":{}}`, dispatch an arbitrary event to your `onEvent` handlers.

For repeatable assertions use `npm test` (scenario tests). The dev server is for interactive iteration. Many authors run both: dev server in one terminal, test watcher in another.

## Deployment

A `.ocpkg` is the distribution format: a single file containing your `plugin.manifest.json`, your plugin **source** (`plugin.js` for JavaScript or `plugin.py` for Python, since the interpreter lives in the Owncast host, so you ship source, not a compiled module), your `public/` and `assets/` directories if you have them, and the optional `icon.png` and `INSTRUCTIONS.md`. The host infers the runtime from that filename, so the manifest needs no `type` field. It's what a server admin installs into Owncast, and they don't see your `package.json`, `node_modules`, or anything else.

Bundle the `.ocpkg`:

```sh
npm run package
```

The file is self-contained. Share it however you like (release on GitHub, hand it to an admin over chat, host it somewhere). The admin has two ways to install it:

1. **Upload from the admin UI.** Open **Plugins** in the Owncast admin and click **Upload plugin**. The new entry appears in the list immediately.
2. **Drop it into `data/plugins/`** on the server. The directory is scanned periodically. The plugin appears in the admin within a couple of seconds.

Either way, the admin then reviews the **Permissions** tab on the plugin's detail page and toggles **Enabled** to load it. Subsequent updates (uploading a new `.ocpkg` with the same `name`) replace the existing entry and trigger the re-approval flow if the new manifest declares additional permissions.

To remove a plugin, an admin clicks the trash icon on the plugin's row in the **Plugins** page and confirms.

`npm run build` produces only the bundled `<slug>.js` and is faster, useful while iterating. `npm run package` is the step you run when you're ready to ship.

To make your plugin discoverable to other operators rather than handing the `.ocpkg` around yourself, **publish it to the plugin directory** at [owncast.directory](https://owncast.directory). See the [Publishing your plugin](https://owncast.online/docs/plugins/publishing) guide for the submission process.

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
    owncast.chat.send(`${msg.user?.displayName ?? "someone"} said: ${msg.body}`);
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

Drops rapid follow-ups. Uses plugin config for per-user state.

```js
const { definePlugin, filter, owncast } = require("@owncast/plugin-sdk");
const MIN_INTERVAL_MS = 2000;

module.exports = definePlugin({
  filterChatMessage(msg) {
    const now = new Date(msg.timestamp).getTime();
    // Key off the stable user id, not the display name (which can change).
    const who = msg.user?.id ?? "anon";
    const last = parseInt(owncast.kv.get(`last:${who}`) || "0", 10);
    if (last && now - last < MIN_INTERVAL_MS) {
      return filter.drop(`${who} must wait ${MIN_INTERVAL_MS}ms`);
    }
    owncast.kv.set(`last:${who}`, String(now));
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
<!-- public/index.html -->
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

Visit `/plugins/overlay/` to render. Owncast owns the chat history. Your plugin just exposes a view of it.

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

`relay` watches for `/announce` in chat and emits a custom event. `announcer` subscribes.

```js
// relay/src/plugin.js, needs events.emit
module.exports = definePlugin({
  onChatMessage(msg) {
    if (!msg.body.startsWith("/announce ")) return;
    owncast.events.emit("announcement.broadcast", {
      text: msg.body.substring(10),
      by: msg.user?.displayName,
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

- **TypeScript works**, name your file `src/plugin.ts` instead of `.js`. The SDK ships TypeScript declarations. Use `import` instead of `require`.
- **Third-party code is limited.** npm packages must be pure JavaScript (no Node built-ins like `fs` or `http`). Python has no `pip`: to use a library, copy its pure-Python source into your project. For outbound HTTP call `owncast.http.fetch`, not `requests` or Node's `http`.
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

> **Note:** the 50 ms cancellation is enforced by the wasm engine itself, which checks the deadline at loop boundaries, so even a tight pure-JS loop with no calls out (e.g. `while (true) {}`) is interrupted at about 50 ms rather than running to the 10 s ceiling. Repeated filter timeouts trip the strike system, which disables the plugin. Realistic plugin code finishes well under the limit, so this isn't something to design around.
