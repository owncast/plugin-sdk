# Owncast Plugin Wire Protocol

The contract between the Owncast host runtime and a plugin. This document is the source of truth that every language SDK (and the host implementation in the Owncast server repo) implements.

## Overview

At the wasm ABI a plugin is a module exposing a fixed set of well-known exports and importing a fixed set of host functions. For interpreted plugins (JavaScript, Python) that module is the host-embedded **shared engine** (one per language, compiled once and instantiated per plugin) running the plugin's source, which the host injects via Extism config at load; a plugin authored directly as a self-contained wasm module presents the same ABI itself. Either way the protocol below is identical. Communication is single-buffer in / single-buffer out: the host writes a JSON or text body before the call, the plugin reads it via the Extism `Host.input*()` helpers, and any return value is written via `Host.output*()`.

## Exports (plugin → host)

Every plugin must export these functions:

| Function          | Input                      | Output                      | Purpose                                                                                               |
| ----------------- | -------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `register`        | none                       | JSON `Manifest`             | Returns the plugin's derived `subscriptions` (compared against the static `plugin.manifest.json`) and its chat `commands` metadata (aggregated by the host for `!help`). |
| `on_event`        | JSON `Envelope`            | none                        | Notification dispatch. Fire-and-forget.                                                               |
| `on_filter`       | JSON `Envelope`            | JSON `FilterResult`         | Filter chain entry point.                                                                             |
| `on_http_request` | JSON `IncomingHttpRequest` | JSON `OutgoingHttpResponse` | HTTP request handler for `/plugins/<name>/*`.                                                         |
| `on_tab_content`  | JSON `ContentRequest`      | raw HTML string             | Render HTML for a dynamic tab (one without a static `content` file in the manifest).                 |
| `on_page_content` | JSON `ContentRequest`      | raw HTML string             | Render HTML for a dynamic `extraPageContent` slot (one without a static `content` file).             |
| `on_page_styles`  | none                       | raw CSS string              | Optional. Return CSS to append to `customStyles` on `/api/config`. Called only when the plugin holds `ui.modify`. |
| `on_page_scripts` | none                       | raw JavaScript string       | Optional. Return JavaScript to append to `/customjavascript`. Same gating as `on_page_styles`.        |

`ContentRequest` shape: `{ "slug": "<tab-or-slot-slug>", "user"?: ChatUser }`. The host calls the appropriate export when building the `/api/config` response; the returned string is inlined directly as the body. An empty string is valid (renders nothing). Each entry point has a per-call timeout enforced by the host. See the host's `dispatcher.go` and `server.go` for current values.

`on_page_styles` and `on_page_scripts` take no input and return no per-viewer content, so the `/api/config` response stays cacheable. They are the dynamic counterparts to the static `manifest.styles` and `manifest.scripts` files: the host appends their output after the static files in the same `customStyles` / `/customjavascript` slots. The host calls them once per `/api/config` for any plugin that exports them and holds `ui.modify`, and wraps each script contribution (static and dynamic) in a try/catch so one plugin's runtime error can't break the shared bundle. A plugin opts in purely by exporting the function, with no manifest field.

### `register` output

`register` returns the static manifest echoed back, plus two fields the SDK
derives at runtime (so authors maintain neither by hand):

- **`subscriptions`** — `{ notify: [{event}], filter: [{event, priority?}] }`, derived from which handlers the plugin defined. The host validates these against the sidecar manifest's permissions.
- **`commands`** — `[{ name, prefix, description?, usage?, aliases?, modOnly? }]`, derived from the plugin's `defineCommands`/`commands` table. Purely informational: the host aggregates it across all loaded plugins to answer the host-owned `!help` (the plugin's own router does the matching). Empty when the plugin declares no commands.

## Imports (host → plugin)

Because all plugins of a language share one engine, the engine imports the **full** set of host functions and the host enforces **permissions at call time**: every host function resolves the calling plugin's identity (from a per-instance config value the host sets at load) and rejects the call — returning a zero/empty result and logging — when the plugin's manifest didn't grant the matching permission. The SDK wrappers still map one-to-one to these imports, so an author only ever calls the ones their permissions allow. (A self-contained wasm plugin that imports an ungranted host function instead fails to link at instantiation, the older structural enforcement.)

### `chat.send`

- `owncast_send_chat(textPtr: PTR): void`, plugin's bot identity, regular message
- `owncast_send_chat_action(textPtr: PTR): void`, same identity, "/me" action style
- `owncast_send_chat_system(bodyPtr: PTR): void`, no user identity, body rendered as HTML
- `owncast_send_chat_to(clientId: I64, textPtr: PTR): void`, private DM to one client

### `chat.history`

- `owncast_chat_history(limit: I32): PTR`, returns JSON `ChatMessage[]`
- `owncast_chat_clients(): PTR`, returns JSON `ChatClient[]`

### `chat.moderate`

- `owncast_delete_message(idPtr: PTR): void`
- `owncast_kick_client(clientId: I64): void`

### `storage.kv`

- `owncast_kv_get(keyPtr: PTR): PTR`, returns text or 0-offset on miss
- `owncast_kv_set(keyPtr: PTR, valPtr: PTR): void`

### `storage.upload`

- `owncast_storage_upload(namePtr: PTR, dataPtr: PTR): PTR`, returns JSON `{url}` or 0-offset on failure

### `storage.fs`

Sandboxed per-plugin filesystem under `data/plugin-data/<slug>/`. The host confines every path to the plugin's own directory.

- `owncast_fs_read(pathPtr: PTR): PTR`, returns the file's raw bytes, or 0-offset when missing/unreadable
- `owncast_fs_write(pathPtr: PTR, dataPtr: PTR): PTR`, returns JSON `{ok, error?}`
- `owncast_fs_list(dirPtr: PTR): PTR`, returns JSON `string[]` of entry names (missing dir → empty)
- `owncast_fs_delete(pathPtr: PTR): PTR`, returns JSON `{ok, error?}`
- `owncast_fs_exists(pathPtr: PTR): I32`, returns 1 if the path exists, 0 otherwise

### `events.emit`

- `owncast_emit_event(eventTypePtr: PTR, payloadPtr: PTR): void`, payload is a JSON-encoded value

### `server.read`

- `owncast_stream_current(): PTR`, JSON `StreamInfo`
- `owncast_stream_broadcaster(): PTR`, JSON `StreamBroadcaster` (read-only inbound-feed telemetry)
- `owncast_server_info(): PTR`, JSON `ServerInfo`
- `owncast_server_socials(): PTR`, JSON `SocialHandle[]`
- `owncast_server_emotes(): PTR`, JSON `Emote[]` (custom chat emotes, `{name, url}`)
- `owncast_server_federation(): PTR`, JSON `FederationInfo`
- `owncast_server_tags(): PTR`, JSON `string[]`

### `videoconfig.read`

- `owncast_video_config_read(): PTR`, JSON `VideoConfig` (`{latencyLevel, codec, variants}`)

### `videoconfig.write`

- `owncast_video_config_write(configPtr: PTR): PTR`, applies a partial `VideoConfigUpdate`; returns JSON `{ok, error?}`

### `notifications.send`

- `owncast_notify_discord(textPtr: PTR): void`
- `owncast_notify_browser_push(payloadPtr: PTR): void`, JSON `BrowserPushPayload`
- `owncast_notify_fediverse(payloadPtr: PTR): void`, JSON `FediversePayload`

### `users.read`

- `owncast_users_list(): PTR`, JSON `User[]`
- `owncast_user_get(idPtr: PTR): PTR`, JSON `User` or 0-offset on miss

### `users.moderate`

- `owncast_user_set_enabled(idPtr: PTR, enabled: I32, reasonPtr: PTR): void`
- `owncast_ban_ip(ipPtr: PTR): void`

### `fediverse.post`

- `owncast_fediverse_post(textPtr: PTR): PTR`, JSON `{url}` or 0-offset on failure

### `network.fetch`

- Not a custom host function, grants the plugin access to Extism's built-in `Http.request`. The host configures Extism's `AllowedHosts` from the manifest's `network.allowedHosts` (see [Manifest extensions](#manifest-extensions) below). Manifests granting `network.fetch` without `network.allowedHosts` are rejected at load.

### `http.serve`

- Not a host function. Grants the host's HTTP server permission to route `/plugins/<name>/*` requests to this plugin's `on_http_request` export and to serve static files from its `public/` directory. The plugin's separate `assets/` directory is read by the host for manifest fields that inline content (`styles`, `scripts`, `extraPageContent`) and is never reachable through the plugin's URL space.

### `http.sse`

- `owncast_sse_send(channelPtr: PTR, eventPtr: PTR, dataPtr: PTR): void`, push one Server-Sent-Events message to every browser connected to `(this plugin, channel)`. `channel` and `event` are plain strings; `data` is the message body (the SDK JSON-encodes non-string values). Fire-and-forget: the call returns immediately and never blocks on a slow or absent client.
- Grants the host permission to serve the reserved `/plugins/<name>/_sse/<channel>` endpoint (see [Host-reserved endpoints](#host-reserved-endpoints)). Independent of `http.serve`: a plugin may stream events without serving any other routes.

### `ui.modify`

- Not a custom host function. Gates UI surfaces that place plugin-contributed elements inside Owncast's own chrome.
- Required when the manifest declares `actions[]`, `styles[]`, `scripts[]`, `extraPageContent`, or `tabs[]`, and required at runtime by `owncast_add_actions` / `owncast_clear_actions`. Manifests that declare any of those fields without `ui.modify` are rejected at load; runtime calls return a permission error.
- `owncast_add_actions(jsonPtr: PTR): u64`, append one or more `ActionButton` entries on top of `manifest.actions`. Argument is a JSON array; the host validates each entry with the same rules as the manifest (title required, exactly one of `url` / `html`, relative URLs and icons auto-prefixed to the plugin's namespace, cross-plugin paths rejected) and persists the merged set to the plugin's config. Returns the host call envelope (success indicator + optional error string).
- `owncast_clear_actions(jsonPtr: PTR): u64`, drop every runtime addition. `manifest.actions` are untouched. Argument is an empty JSON object (`"{}"`) for API symmetry; returns the host call envelope.

### `chat.filter`

- Not a custom host function. Gates the `filter_chat_message` export: a plugin that registers a `filterChatMessage` handler must declare this permission at load time, otherwise the host rejects the manifest.
- This is deliberately separate from `chat.send`, `chat.history`, and `chat.moderate`: filtering happens inline on every chat message before broadcast (modify the body, drop the message, or pass it through), so the manifest reviewer needs to see it called out explicitly.

### ambient (no permission)

These imports are granted to every plugin without a declared permission. A plugin can't `setTimeout` or read its own config without the host, and the acts themselves are benign (a scheduled callback still needs its own permissions to do anything; reading your own manifest-declared config exposes nothing new).

- `owncast_timer_set(id: I64, delayMs: I64, repeat: I32): I32`, schedule a host-driven timer; the host fires the `timer.fire` event (payload `{id}`) when it elapses. Returns 1 on success, 0 if the plugin is at its pending-timer cap. `delayMs` is clamped to `[100, 86_400_000]`. The SDK maps `id`→callback for `owncast.timer.setTimeout/setInterval`.
- `owncast_timer_clear(id: I64): void`, cancel a pending timer by id.
- `owncast_config_get(keyPtr: PTR): PTR`, returns the JSON value of a `manifest.config` key (admin override, else declared default), or 0-offset for an unknown/unset key.
- `owncast_asset_read(pathPtr: PTR): PTR`, returns the raw bytes of a file from the plugin's own `assets/` directory, or 0-offset when the file is missing or the path escapes the directory. The path is relative to `assets/` and must not start with `/` or contain `..` segments; the host rejects any path that would escape the plugin's own asset tree. Plugins use this to load bundled resources (templates, data files) at request time without needing `storage.fs`.

The host also dispatches a `tick` event (payload `{now}`, host wall-clock ms) about once a second to any plugin defining `onTick`, independent of timers.

## Host-reserved endpoints

These paths under `/plugins/<name>/` are owned by the host. The plugin's `on_http_request` never sees them; they cannot be overridden by a plugin's own routes.

### `GET /api/plugins/<name>/icon`

Returns the raw bytes of the plugin's `icon.png` if one was bundled at the root of the `.ocpkg` (or next to the plugin's code file as `<base>.icon.png` for the loose-files layout). 404 when no icon is present. No `http.serve` permission required: this is a host endpoint, served independently of the plugin's own routes, so a plugin that ships an icon for the admin UI doesn't need any HTTP surface of its own. Returned with `Content-Type: image/png` and `Cache-Control: no-cache` so a swapped icon shows up on the next admin reload.

### `GET /api/admin/plugins/<name>/instructions`

Returns the raw markdown of the plugin's `INSTRUCTIONS.md` if one was bundled at the root of the `.ocpkg` (or next to the plugin's code file as `<base>.INSTRUCTIONS.md` for the loose-files layout). 404 when none is present. Admin-authenticated, since it's part of the plugin-management API rather than a public asset. No `http.serve` permission required. Returned with `Content-Type: text/markdown` and `Cache-Control: no-cache` so swapped instructions show up on the next admin reload; the admin UI renders the markdown in an **Instructions** tab on the plugin's details page.

### `GET /plugins/<name>/_sse/<channel>`

A long-lived [Server-Sent-Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream. The browser opens it with `EventSource`; the host holds the connection open and writes each frame the plugin pushes via `owncast.sse.send(channel, …)`. The segment after `_sse/` is the channel name (empty selects the default channel), letting one plugin run several independent streams (e.g. `overlay` and `admin-stats`).

The plugin process is **not** involved in serving the connection, no wasm call is made per request and the per-plugin call mutex is never held, so an idle stream costs only a goroutine. This is the supported way to do realtime push: a plugin's own `on_http_request` cannot stream, because each call is a single buffered request/response bounded by the HTTP handler timeout.

Host behavior:

- Requires the `http.sse` permission; 404 otherwise.
- A channel that matches a `manifest.admin.pages[]` glob is auth-gated like any other admin path (401 if not authenticated).
- Connections are capped per-plugin (default 64); over the cap returns 503.
- Idle streams get a `: keep-alive` comment line every 15s so proxies don't drop them.
- Delivery is best-effort: each client has a small send buffer, and frames are dropped for a client that can't keep up rather than blocking the publishing plugin.
- Frame format: an `event: <name>` line when the event is non-empty, one `data: <line>` per newline in the body, terminated by a blank line.

## Manifest extensions

The plugin manifest carries a few host-facing declarations beyond identity and permissions. The host parses these at load time; they don't ride over wasm.

### `manifest.actions[]`

An array of `ActionButton` entries the host merges into Owncast's external-action list while the plugin is enabled. Shape matches Owncast's `ExternalAction`:

```json
{
  "title": "string (required)",
  "url": "string (URL or relative path; mutually exclusive with html)",
  "html": "string (raw HTML; mutually exclusive with url)",
  "icon": "string (URL or relative path)",
  "color": "string (hex)",
  "description": "string",
  "openExternally": false
}
```

Host validation:

- `title` required; exactly one of `url` or `html` required.
- `ui.modify` permission required (see [`ui.modify`](#uimodify)).
- Relative `url` paths starting with `/` but not `/plugins/` are rewritten to `/plugins/<plugin-name>/<path>`.
- URLs resolving into the plugin's own namespace require `http.serve`; load fails otherwise.
- URLs pointing at another plugin's namespace are rejected at load.
- The `icon` field follows the same path-handling rules as `url`: relative paths auto-prefix into the plugin's namespace (and require `http.serve` to actually serve), absolute `https://...` URLs pass through, cross-plugin icon paths are rejected.

Runtime additions go through `owncast_add_actions` / `owncast_clear_actions` (see [`ui.modify`](#uimodify)). The host validates each runtime entry with the same rules above and persists the merged set under the reserved `owncast.actions` key inside the plugin's config.

The host exposes the merged list as `GET /api/plugins/actions` (public). The Owncast server is responsible for folding that into its existing `/api/externalactions` response.

### `manifest.admin.pages[]`

Glob-matched routes inside `/plugins/<name>/...` that the host auth-gates before reaching the plugin's `on_http_request`. See `manifest.go:AdminPage`.

### `manifest.network.allowedHosts[]`

Hostname globs the plugin is allowed to reach via `owncast.http.fetch`. Passed straight through to Extism's `AllowedHosts`. Required when `network.fetch` is granted; the wildcard `"*"` is permitted but must be written explicitly so the manifest reflects the granted scope.

The host surfaces this list on `GET /api/admin/plugins` (as `allowedHosts: []string` on each `DiscoveredEntry`) and the admin UI renders it alongside the `network.fetch` row in the Permissions tab, so an admin reviewing a plugin sees exactly which hosts it can reach without unpacking the `.ocpkg`.

### `manifest.styles[]`

An array of relative paths to CSS files the plugin contributes to the viewer page. The host reads each file's bytes from the plugin's `assets/` directory and appends them to the admin's customStyles in the `/api/config` response, so a viewer renders one `<style>` block covering admin and plugin contributions. The file is never reachable through the plugin's URL space.

Per-entry validation:

- `ui.modify` permission required (the file is inlined, not served, so `http.serve` is not required).
- Bare or single-slash paths (`"theme.css"`, `"/theme.css"`) auto-prefix to `/plugins/<name>/theme.css`.
- Fully qualified `/plugins/<name>/...` paths pass through.
- Paths in another plugin's namespace are rejected at load.
- `http://` and `https://` URLs are rejected at load.
- Each entry must end in `.css`.

Each plugin contribution in the concatenated response is preceded by a `/* plugin: <slug> — <file> */\n` comment so devtools "view source" can attribute a rule back to whichever plugin shipped it. Disabling the plugin drops its contribution on the next `/api/config` request.

### `manifest.scripts[]`

An array of relative paths to JavaScript files the plugin contributes to the viewer page. The host reads each file's bytes from the plugin's `assets/` directory and appends them to the response served at `/customjavascript`, so a viewer loads one `<script>` tag covering admin and plugin contributions.

Same per-entry rules as `manifest.styles[]`, applied to `.js` files (only `ui.modify` required; the file is inlined, not served). Contributions are separated by `// plugin: <slug> — <file>\n` delimiter comments. Every plugin's JavaScript runs in the viewer page's shared global scope; authors are expected to wrap their script in an IIFE so top-level declarations don't collide.

### `manifest.extraPageContent`

An object the plugin contributes to the viewer's extra-content block. The host prepends the resolved HTML to the admin's rendered `extraPageContent` on `/api/config`, so plugin HTML lands above the admin's prose.

```json
{
  "slug": "string (required, identifies the slot — passed to on_page_content)",
  "content": "string (optional, relative path to assets/<file>.html)"
}
```

Validation:

- `ui.modify` permission required.
- `http.serve` is **not** required: the HTML is inlined into the API response, not served at a URL.
- `slug` must be a valid slug (lowercase letters/digits/hyphens, starting with a letter, max 64 chars).
- When `content` is present, the same path-shape rules as `manifest.styles[]` apply (must end in `.html`).

**Static** (`content` present): the host reads the file from `assets/` and inlines its bytes.

**Dynamic** (`content` absent): the host calls `on_page_content` with `{ slug, user? }` and inlines the returned HTML string. `user` carries the requesting viewer's chat identity when available.

Each contribution is wrapped with an `<!-- plugin: <slug> — <file> -->\n` comment for in-page attribution. The admin's content goes through the markdown processor before plugin HTML is prepended; plugin HTML is left raw so tags and attributes pass through as written.

### `manifest.tabs[]`

An array of viewer-page tabs the plugin contributes alongside the built-in tabs (Followers, About).

```json
{
  "title": "string (required, tab label)",
  "slug": "string (required, stable identifier — passed to on_tab_content)",
  "content": "string (optional, relative path to assets/<file>.html)"
}
```

Validation:

- `ui.modify` permission required.
- `http.serve` is **not** required: each tab's HTML is inlined into the response, not served at a URL.
- `title` must be non-empty. Unique within the plugin's tabs.
- `slug` must be a valid slug. Unique within the plugin's tabs. Passed to `on_tab_content` so the plugin knows which tab to render.
- When `content` is present, the same path rules as `manifest.extraPageContent.content` apply (must end in `.html`).

**Static** (`content` present): the host reads the file from `assets/` and inlines its bytes.

**Dynamic** (`content` absent): the host calls `on_tab_content` with `{ slug, user? }` and inlines the returned HTML string.

The host emits the tab list on `GET /api/config` under `pluginTabs[]` as `[{slug, title, html}]` entries. The viewer page maps each entry to a tab whose body renders the inlined HTML. `slug` doubles as the React key so a tab only unmounts when the source plugin is disabled/removed.

## Payload types

The JSON shapes for `Manifest`, `Envelope`, `ChatMessage`, `FediverseInboundPost`, etc. are documented in the JS SDK's `index.d.ts` as TypeScript interfaces. Future SDKs (Go, Python) port these shapes into their native type system; the over-the-wire JSON is identical.

## Conformance

Each language SDK is responsible for:

- Declaring the imports listed above (gated by manifest permissions) so the plugin author's call into `owncast.chat.send(...)` resolves to the right wasm import.
- Encoding/decoding payloads as JSON or text per the table above.
- Implementing the exports' dispatch loop: parse the envelope, route to the right handler, serialize the response. This covers all eight exports: `register`, `on_event`, `on_filter`, `on_http_request`, `on_tab_content`, `on_page_content`, `on_page_styles`, and `on_page_scripts`.

The Owncast server repo's plugin runtime is responsible for:

- Registering each host function under the right Extism namespace and permission gate.
- Calling exports with the right input shapes and observing the documented timeout / size caps.

A drift test in each repo asserts its host-fn registrations match the names in this doc. See `host-runtime/plugin/sdk_drift_test.go` for the PoC version.
