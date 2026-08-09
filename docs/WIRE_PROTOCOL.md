# Owncast Plugin Wire Protocol

This is the author-facing contract between the Owncast host runtime and a
plugin. Owncast's stack-based host functions are the implementation source of
truth.

## Overview

At the Wasm ABI a plugin exposes fixed exports and imports fixed host
functions. Interpreted JavaScript and Python plugins run inside a shared engine
that presents this ABI. A self-contained Wasm plugin presents it directly.
Exports use Extism's single input and output buffers. Host imports use the
stack signatures and memory pointers documented below.

## Exports (plugin → host)

Every plugin must export these functions:

| Function          | Input                      | Output                      | Purpose                                                                                               |
| ----------------- | -------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `register`        | none                       | JSON `Manifest`             | Returns derived subscriptions and command declarations.                                               |
| `on_event`        | JSON `Envelope`            | none                        | Notification dispatch. Fire-and-forget.                                                               |
| `on_filter`       | JSON `Envelope`            | JSON `FilterResult`         | Filter chain entry point.                                                                             |
| `on_http_request` | JSON `IncomingHttpRequest` | JSON `OutgoingHttpResponse` | HTTP request handler for `/plugins/<name>/*`.                                                         |
| `on_tab_content`  | JSON `ContentRequest`      | raw HTML string             | Render HTML for a dynamic tab (one without a static `content` file in the manifest).                 |
| `on_page_content` | JSON `ContentRequest`      | raw HTML string             | Render HTML for a dynamic `extraPageContent` slot (one without a static `content` file).             |
| `on_page_styles`  | none                       | raw CSS string              | Optional. Return CSS to append to `customStyles` on `/api/config`. Called only when the plugin holds `ui.modify`. |
| `on_page_scripts` | none                       | raw JavaScript string       | Optional. Return JavaScript to append to `/customjavascript`. Same gating as `on_page_styles`.        |
| `on_auth_check`   | JSON `AuthCheckRequest`    | JSON `AuthCheckResult`      | Optional. Re-validate a gate session on the viewer's `/` page load. Returns `{action: ok\|refresh\|deny}`. Called by the host only for the active `auth.gate` plugin. |

`ContentRequest` shape: `{ "slug": "<tab-or-slot-slug>", "user"?: User }`. The host calls the appropriate export when building the `/api/config` response. The returned string is inlined directly as the body. An empty string is valid (renders nothing). Each entry point has a per-call timeout enforced by the host. See the host's `dispatcher.go` and `server.go` for current values.

`on_page_styles` and `on_page_scripts` take no input and return no per-viewer content, so the `/api/config` response stays cacheable. They are the dynamic counterparts to the static `manifest.styles` and `manifest.scripts` files: the host appends their output after the static files in the same `customStyles` / `/customjavascript` slots. The host calls them once per `/api/config` for any plugin that exports them and holds `ui.modify`, and wraps each script contribution (static and dynamic) in a try/catch so one plugin's runtime error can't break the shared bundle. A plugin opts in purely by exporting the function, with no manifest field.

### `register` output

`register` returns the static manifest echoed back, plus two fields the SDK
derives at runtime:

- **`subscriptions`**: `{ notify: [{event}], filter: [{event, priority?}] }`,
  derived from the plugin's ordinary handlers. The host validates these against
  the sidecar manifest's permissions.
- **`commands`**:
  `[{ name, prefix, description?, usage?, aliases?, modOnly?, caseSensitive?, cooldownMs? }]`.
  The host matches accepted human chat messages against every loaded plugin's
  declarations. Duplicate commands all run. Moderator failures, cooldown
  rejections, and unknown commands are silent. The same metadata builds the
  built-in `!help` response.

Matched declarations receive an internal `chat.command` envelope through
`on_event`. Its payload is
`{ message, command, invokedAs, args, argString }`. `message` is the original
`ChatMessage`, `command` is the canonical declaration, and `invokedAs` preserves
the name or alias the sender typed. The SDK maps this event to the declared
handler. Plugins do not subscribe to `chat.command`, cannot emit it, and need no
permission to receive it. Permissions still apply to actions taken by the
handler.

Command matching runs after chat filters and ordinary chat notification.
Filtered messages cannot execute commands. Command messages, including
`!help`, remain ordinary chat messages. Owncast's built-in help response does
not prevent plugins from also responding.

## Imports (host → plugin)

All custom imports use the `extism:host/user` namespace. The shared JavaScript
and Python engines import the full set. The host resolves the calling plugin
and checks its manifest permission on every call. A denied call logs the
denial and returns 0 for a `PTR` or `I64` result. A denied `void` call has no
observable result.

Both SDKs map that empty result onto one rule: an import whose output is an
operation-result envelope (`{}` or `{"error": string}`) raises when the
envelope is missing or carries an error, so a denial surfaces as a thrown
`Error` / `RuntimeError` rather than a silent success. Imports that return
data yield empty or null instead. `owncast_fs_write`, `owncast_fs_delete`, and
`owncast_storage_upload` are the deliberate exceptions: the SDKs hand their
envelope back to the author instead of raising.

### ABI types and pointer payloads

The signatures below are the exact stack-based host ABI:

- `I64` is a WebAssembly `i64` scalar. Boolean inputs and outputs use 0 for
  false and 1 for true unless a function says otherwise.
- `PTR` is Extism's pointer value, carried in an `i64` stack slot. It identifies
  one Extism-managed guest-memory allocation whose byte length Extism tracks.
  It is not a null-terminated C pointer.
- A **UTF-8 string** pointer contains only the encoded string bytes.
- A **JSON** pointer contains one UTF-8 encoded JSON value of the named shape.
- A **raw bytes** pointer may contain arbitrary bytes and must not be decoded or
  JSON-parsed by the host.
- `void` means no output stack value. `()` means no input stack values.

A returned `PTR` identifies a host-written allocation in the calling plugin's
memory. A 0 return means no value or failure only where noted below. There are
no custom `I32` host imports.

### `chat.send`

- `owncast_send_chat(textPtr: PTR): void`. Input: `textPtr` is a UTF-8 string.
  Output: none. Sends a regular message using the plugin's bot identity.
- `owncast_send_chat_action(textPtr: PTR): void`. Input: `textPtr` is a UTF-8
  string. Output: none. Sends a `/me`-style action using the bot identity.
- `owncast_send_chat_system(bodyPtr: PTR): void`. Input: `bodyPtr` is a UTF-8
  HTML string. Output: none. Sends a system message without a user identity.
- `owncast_send_chat_to(clientId: I64, textPtr: PTR): void`. Inputs: `clientId`
  is the scalar chat client ID and `textPtr` is a UTF-8 string. Output: none.

### `chat.history`

- `owncast_chat_history(limit: I64): PTR`. Input: non-positive `limit` values
  select the host default of 50 rows; positive values request that row limit.
  Output: JSON `ChatMessage[]`.
- `owncast_chat_clients(): PTR`. Input: none. Output: JSON `ChatClient[]`.

### `chat.moderate`

- `owncast_delete_message(idPtr: PTR): PTR`. Input: `idPtr` is a UTF-8 message
  ID. Output: JSON `{"error": string}` on failure or `{}` on success.
- `owncast_kick_client(clientId: I64): PTR`. Input: `clientId` is the scalar
  chat client ID. Output: JSON `{"error": string}` on failure or `{}` on success.

### `storage.kv`

- `owncast_kv_get(keyPtr: PTR): PTR`. Input: `keyPtr` is a UTF-8 key. Output:
  a UTF-8 string, or 0 when the key is missing.
- `owncast_kv_set(keyPtr: PTR, valPtr: PTR): PTR`. Inputs: both pointers
  contain UTF-8 strings. Output: JSON `{"error": string}` on failure or `{}`
  on success.

### `storage.upload`

- `owncast_storage_upload(namePtr: PTR, dataPtr: PTR): PTR`. Inputs: `namePtr`
  is a UTF-8 filename and `dataPtr` is raw bytes. Output: JSON
  `{"url": string}`, or 0 on failure.

### `storage.fs`

Sandboxed per-plugin filesystem under
`data/plugin-storage/<slug>/files/`. The host confines every path to the
plugin's own directory.

- `owncast_fs_read(pathPtr: PTR): PTR`, returns the file's raw bytes, or 0-offset when missing/unreadable
- `owncast_fs_write(pathPtr: PTR, dataPtr: PTR): PTR`, returns JSON `FSResult` (`{error?}`). An empty object means success.
- `owncast_fs_list(dirPtr: PTR): PTR`, returns JSON `string[]` of direct entry names (missing dir → empty)
- `owncast_fs_delete(pathPtr: PTR): PTR`, returns JSON `FSResult` (`{error?}`). An empty object means success.
- `owncast_fs_exists(pathPtr: PTR): I64`, returns 1 if the path exists, 0 otherwise

### `storage.sql`

The host opens one private SQLite database per plugin at
`data/plugin-storage/<slug>/db/plugin.db`. The `storage.fs` sandbox is rooted at
`data/plugin-storage/<slug>/files/`, so `db/` is not a path the `storage.fs` API
refuses, it is one that API cannot express, and the two quotas stay independent
because the filesystem quota walk covers `files/` only. A plugin's database is
capped at 128 MiB, separate from the 256 MiB `storage.fs` quota. Plugin
databases are not included in Owncast's database backups. The host keeps a
plugin's SQL data when the plugin is uninstalled, the same way it keeps its
config and its `storage.fs` files, and an operator reclaims all of a plugin's
space by deleting the one directory `data/plugin-storage/<slug>/`.

- `owncast_sql_exec(requestPtr: PTR): PTR`, returns JSON `SQLExecResult`
- `owncast_sql_query(requestPtr: PTR): PTR`, returns JSON `SQLQueryResult`

Both take the same request JSON. `params` is an optional array of scalar values,
and `maxRows` is optional:

```json
{ "sql": "SELECT name FROM viewers WHERE seen > ?", "params": [1730000000], "maxRows": 100 }
```

A parameter is `null`, a boolean, a number, or a string. Any other JSON type
fails the call.

`SQLExecResult` is `{error?, rowsAffected, lastInsertId}`, both counters 64-bit.
`SQLQueryResult` is
`{error?, columns: string[], rows: any[][], truncated?}`, one `rows` entry per
row with values in `columns` order. Use SQL column aliases when selecting
duplicate column names. Absence of `error` means success. A failed operation
sets `error`.

The SDKs reject a missing or non-object host response instead of treating it as
success.

`maxRows` omitted or 0 means no caller limit, and the host never silently
returns a short result for an unbounded query: once the result passes the row cap
or the result-size budget, the call fails with an error telling the author to add
a `LIMIT`. A value from 1 through 10000 is caller intent, so the host returns at
most that many rows and sets `truncated` true when more rows matched. Values
below 0 or above 10000 are invalid. Reading one row out of a large table is the
bounded case: the SDK's `queryRow` sends `maxRows: 1`.

Limits the host applies to every `exec` and `query`:

- request JSON: 64 KiB, which bounds the statement text along with it
- bound parameters: 64
- one returned column value: 1 MiB
- whole encoded query result: 1 MiB
- rows returned: 10000
- one call: 2 seconds, including time spent waiting for the plugin's serialized connection

Each `exec` call runs as one host-owned transaction: a multi-statement batch
either commits whole or leaves the database untouched, and a plugin cannot leave
a transaction open across calls.

These operations are refused, in every host:

- `ATTACH` and `DETACH`
- every `PRAGMA`, reads included
- temporary-schema DDL, both the keyword forms (`CREATE TEMP TABLE` / `INDEX` /
  `TRIGGER` / `VIEW`) and the schema-qualified ones (`CREATE TABLE temp.x`),
  which SQLite reports as ordinary DDL against the `temp` schema
- `load_extension()`
- `VACUUM` and `VACUUM INTO`
- transaction controls: `BEGIN`, `COMMIT`, `END`, `ROLLBACK`, `SAVEPOINT`, and
  `RELEASE`

Owncast refuses them twice. A SQLite authorizer on each connection is the gate,
because it sees the compiled statement: every statement in a multi-statement
string runs, so an operation smuggled in behind a permitted one would defeat a
check on the text alone. In front of that, the host runtime refuses the same
list in Go before the statement reaches a driver. That second check is what lets
a host without an authorizer (the SDK's test runner and dev server, which use a
pure-Go SQLite driver so they can cross-compile) reach the same verdict, so a
plugin that passes its scenario tests is not about to fail on a real server.

Those refusals cost ordinary SQL nothing: DDL, DML, indexes, views, triggers,
`ORDER BY` sorts, recursive CTEs, subqueries, `UNION`, and the json1 functions
all work, as do identifiers that merely begin with `temp`.

An integral JSON parameter binds as a SQLite INTEGER exactly, including values
beyond 2^53 when the guest language can represent them. Python can bind and
read exact 64-bit integers. JavaScript loses unsafe integers before
`JSON.stringify` on writes and during `JSON.parse` on reads, so a JavaScript
plugin should store values above `Number.MAX_SAFE_INTEGER` (2^53 - 1) as TEXT.

### `events.emit`

- `owncast_emit_event(eventTypePtr: PTR, payloadPtr: PTR): void`. Inputs:
  `eventTypePtr` is a UTF-8 event name and `payloadPtr` is one JSON value.
  Output: none.

### `server.read`

- `owncast_stream_current(): PTR`. Input: none. Output: JSON `StreamInfo`.
- `owncast_stream_broadcaster(): PTR`. Input: none. Output: JSON
  `StreamBroadcaster`.
- `owncast_server_info(): PTR`. Input: none. Output: JSON `ServerInfo`.
- `owncast_server_socials(): PTR`. Input: none. Output: JSON `SocialHandle[]`.
- `owncast_server_emotes(): PTR`. Input: none. Output: JSON `Emote[]`.
- `owncast_server_federation(): PTR`. Input: none. Output: JSON
  `FederationInfo`.
- `owncast_server_tags(): PTR`. Input: none. Output: JSON `string[]`.

### `videoconfig.read`

- `owncast_video_config_read(): PTR`. Input: none. Output: JSON `VideoConfig`
  with `latencyLevel`, `codec`, `autoplay`, and `variants`.

### `videoconfig.write`

- `owncast_video_config_write(configPtr: PTR): PTR`. Input: `configPtr` is JSON
  partial `VideoConfigUpdate`. Output: JSON `VideoConfigWriteResult`
  (`{error?}`). An empty object means success.

### `notifications.send`

- `owncast_notify_discord(textPtr: PTR): void`. Input: `textPtr` is a UTF-8
  string. Output: none.
- `owncast_notify_browser_push(payloadPtr: PTR): void`. Input: `payloadPtr` is
  JSON `BrowserPushPayload`. Output: none.
- `owncast_notify_fediverse(payloadPtr: PTR): void`. Input: `payloadPtr` is JSON
  `FediversePayload`. Output: none.

### `users.read`

- `owncast_users_list(): PTR`. Input: none. Output: JSON `User[]`.
- `owncast_user_get(idPtr: PTR): PTR`. Input: `idPtr` is a UTF-8 user ID.
  Output: JSON `User`, or 0 when the user is missing.

### `users.moderate`

- `owncast_user_set_enabled(idPtr: PTR, enabled: I64, reasonPtr: PTR): PTR`.
  Inputs: `idPtr` is a UTF-8 user ID, `enabled` is scalar 0 or 1, and
  `reasonPtr` is a UTF-8 reason. Output: JSON `{"error": string}` on failure or
  `{}` on success.
- `owncast_ban_ip(ipPtr: PTR): PTR`. Input: `ipPtr` is a UTF-8 IP address.
  Output: JSON `{"error": string}` on failure or `{}` on success.

### `users.register`

Find or create an authenticated Owncast user for an external identity. A viewer
authentication gate uses this before granting a session.

- `owncast_users_register(reqPtr: PTR): PTR`. Input: `reqPtr` is JSON
  `UserRegisterRequest`. Output: JSON `UserRegisterResult`. The host supplies the
  calling plugin's slug as the identity provider namespace and keeps `authId`
  as the unmodified provider-specific ID. The host rejects administrative or
  otherwise disallowed scopes.

  `displayName` is optional and nullable. When omitted or `null`, the host generates
  the user's display name.

### `auth.gate`

Only one `auth.gate` plugin can be enabled at a time. These calls are meaningful
inside `on_http_request`, where the host can attach or clear the signed session
cookie. The plugin never receives the token. The operator's host-owned access
mode is not part of the plugin wire protocol and a plugin cannot read or change
it.

The operator selects one cumulative host mode: website only, website and
stream, or website, stream, and status.

- `owncast_auth_grant_session(reqPtr: PTR): PTR`. Input: `reqPtr` is JSON
  `GrantSessionRequest`. Output: JSON `{"error"?: string}`.
- `owncast_auth_end_session(): void`. Input: none. Output: none.

The optional `on_auth_check` export lets the gate revalidate a session on each
viewer page load and return `ok`, `refresh`, or `deny`.

### `fediverse.post`

- `owncast_fediverse_post(textPtr: PTR): PTR`. Input: `textPtr` is a UTF-8
  string. Output: JSON `{"url": string}`, or 0 on failure.

### `network.fetch`

This permission grants access to Extism's built-in `Http.request`. It does not
add a custom host import. The host configures `AllowedHosts` from
`manifest.network.allowedHosts`. A manifest that grants `network.fetch` without
an allowed-host list is rejected at load.

The wildcard `"*"` is allowed only when the manifest states it explicitly.

### `http.serve`

This permission does not add a custom host import. It lets the host route
`/plugins/<name>/*` requests to `on_http_request` and serve the plugin's
`public/` directory.

The separate `assets/` directory is read by the host for manifest content and
is not served from the plugin's URL space.

### `http.sse`

- `owncast_sse_send(channelPtr: PTR, eventPtr: PTR, dataPtr: PTR): void`.
  Inputs: all three pointers contain UTF-8 strings. `channelPtr` names the
  stream, `eventPtr` names the SSE event, and `dataPtr` contains its text data.
  Output: none. The call queues one event for every browser connected to the
  plugin and channel.
  The call returns after queueing the frame and does not wait for browsers to
  consume it.

The permission also lets the host serve the reserved
`/plugins/<name>/_sse/<channel>` endpoint. It is independent of `http.serve`.

### `ui.modify`

This permission gates UI surfaces inside Owncast's chrome. A manifest that
declares actions, styles, scripts, extra page content, or tabs without
`ui.modify` is rejected at load.

- `owncast_add_actions(actionsPtr: PTR): PTR`. Input: `actionsPtr` is JSON
  `ActionButton[]`. The host validates and appends the actions to the plugin's
  runtime action list, returning JSON `{error?: string}`. A missing `error`
  means success. Each action needs a title and exactly one of `url` or `html`.
  The host rewrites relative URLs and icons into the plugin's namespace,
  rejects cross-plugin paths, and persists the merged runtime list in plugin
  config. The SDK throws when the host returns an error.
- `owncast_clear_actions(): PTR`. Input: none. Output: JSON
  `{"error": string}` on failure or `{}` on success. Clears runtime actions
  without changing `manifest.actions`.

### `chat.filter`

This permission gates the `filter_chat_message` export. A plugin that registers
a `filterChatMessage` handler without it is rejected at load. It is separate
from chat sending, history, and moderation because filtering runs inline before
broadcast.

A filter can modify the message body, drop the message, or pass it through.

### `fediverse.inbound`

This permission gates notify subscriptions to `fediverse.activity`,
`fediverse.follow`, `fediverse.like`, `fediverse.repost`, `fediverse.quote`,
`fediverse.mention`, and `fediverse.reply`. These are internal plugin events,
not external HTTP webhooks.

`fediverse.activity` carries the verified inbound activity as a raw JSON
object. It fires alongside a matching specialized event and also covers
verified activity types without a specialized event. `fediverse.quote` carries
a `FediverseQuote`. Its `target` is the quoted local post and its `url` is the
remote quote post. Content fields are present when the `QuoteRequest` embeds
the quote `Note`. Mentions and replies are verified public `Create(Note)`
activities tied to the local account or a locally authored post.

### ambient (no permission)

These imports are available to every plugin:

- `owncast_timer_set(id: I64, delayMs: I64, repeat: I64): I64`. Inputs: `id`
  and `delayMs` are scalar integers. The host clamps `delayMs` to
  `[100, 86_400_000]`. `repeat` is 1 for an interval and any other value for a
  one-shot timer. Output: scalar 1 on success and 0 at the pending-timer cap.
- `owncast_timer_clear(id: I64): void`. Input: `id` is a scalar timer ID.
  Output: none.
- `owncast_config_get(keyPtr: PTR): PTR`. Input: `keyPtr` is a UTF-8 manifest
  config key. Output: one JSON value, or 0 for an unknown or unset key.
- `owncast_asset_read(pathPtr: PTR): PTR`. Input: `pathPtr` is a UTF-8 path
  relative to the plugin's `assets/` directory. Output: raw file bytes, or 0
  when the path is missing, invalid, or unreadable.
- `owncast_log_info(messagePtr: PTR): void`, write an info entry to the Owncast server log
- `owncast_log_warning(messagePtr: PTR): void`, write a warning entry to the Owncast server log
- `owncast_log_error(messagePtr: PTR): void`, write an error entry to the Owncast server log

The host attributes every entry to the calling plugin's slug and preserves the selected severity in its logrus output. The fixed functions keep unknown levels out of the wire contract.

The host also dispatches a `tick` event (payload `{now}`, host wall-clock ms) about once a second to any plugin defining `onTick`, independent of timers.

## Host-reserved endpoints

These paths under `/plugins/<name>/` are owned by the host. The plugin's `on_http_request` never sees them. They cannot be overridden by a plugin's own routes.

### `GET /api/plugins/<name>/icon`

Returns the raw bytes of the plugin's `icon.png` if one was bundled at the root of the `.ocpkg` (or next to the plugin's code file as `<base>.icon.png` for the loose-files layout). 404 when no icon is present. No `http.serve` permission required: this is a host endpoint, served independently of the plugin's own routes, so a plugin that ships an icon for the admin UI doesn't need any HTTP surface of its own. Returned with `Content-Type: image/png` and `Cache-Control: no-cache` so a swapped icon shows up on the next admin reload.

### `GET /api/admin/plugins/<name>/instructions`

Returns the raw markdown of the plugin's `INSTRUCTIONS.md` if one was bundled at the root of the `.ocpkg` (or next to the plugin's code file as `<base>.INSTRUCTIONS.md` for the loose-files layout). 404 when none is present. Admin-authenticated, since it's part of the plugin-management API rather than a public asset. No `http.serve` permission required. Returned with `Content-Type: text/markdown` and `Cache-Control: no-cache` so swapped instructions show up on the next admin reload. The admin UI renders the markdown in an **Instructions** tab on the plugin's details page.

### `GET /plugins/<name>/_sse/<channel>`

A long-lived [Server-Sent-Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream. The browser opens it with `EventSource`. The host holds the connection open and writes each frame the plugin pushes via `owncast.sse.send(channel, …)`. The segment after `_sse/` is the channel name (empty selects the default channel), letting one plugin run several independent streams (e.g. `overlay` and `admin-stats`).

The plugin process is **not** involved in serving the connection, no wasm call is made per request and the per-plugin call mutex is never held, so an idle stream costs only a goroutine. This is the supported way to do realtime push: a plugin's own `on_http_request` cannot stream, because each call is a single buffered request/response bounded by the HTTP handler timeout.

Host behavior:

- Requires the `http.sse` permission, 404 otherwise.
- A channel that matches a `manifest.admin.pages` path glob is auth-gated like any other admin path (401 if not authenticated).
- Connections are capped per-plugin (default 64). Over the cap returns 503.
- Idle streams get a `: keep-alive` comment line every 15s so proxies don't drop them.
- Delivery is best-effort: each client has a small send buffer, and frames are dropped for a client that can't keep up rather than blocking the publishing plugin.
- Frame format: an `event: <name>` line when the event is non-empty, one `data: <line>` per newline in the body, terminated by a blank line.

## Manifest extensions

The plugin manifest carries a few host-facing declarations beyond identity and permissions. The host parses these at load time. They don't ride over wasm.

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

- `title` required. Exactly one of `url` or `html` required.
- `ui.modify` permission required (see [`ui.modify`](#uimodify)).
- Relative `url` paths starting with `/` but not `/plugins/` are rewritten to `/plugins/<plugin-name>/<path>`.
- URLs resolving into the plugin's own namespace require `http.serve`, load fails otherwise.
- URLs pointing at another plugin's namespace are rejected at load.
- The `icon` field follows the same path-handling rules as `url`: relative paths auto-prefix into the plugin's namespace (and require `http.serve` to actually serve), absolute `https://...` URLs pass through, cross-plugin icon paths are rejected.

Runtime additions go through `owncast_add_actions` / `owncast_clear_actions` (see [`ui.modify`](#uimodify)). The host validates each runtime entry with the same rules above and persists the merged set under the reserved `owncast.actions` key inside the plugin's config.

The host exposes the merged list as `GET /api/plugins/actions` (public). The Owncast server is responsible for folding that into its existing `/api/externalactions` response.

### `manifest.admin.pages`

An object of plugin-relative path glob keys to admin-page definitions. The host auth-gates matching routes inside `/plugins/<name>/...` before they reach the plugin's `on_http_request`.

```json
{
  "/admin": {
    "title": "Settings",
    "icon": "gear"
  },
  "/admin/*": {
    "title": "Settings"
  }
}
```

Each key must start with `/`. Each value requires a non-empty `title` and may include `icon`. The host processes pages in lexicographic path order because JSON object order is not significant.

### `manifest.network.allowedHosts[]`

Hostname globs the plugin is allowed to reach via `owncast.http.fetch`. Passed straight through to Extism's `AllowedHosts`. Required when `network.fetch` is granted. The wildcard `"*"` is permitted but must be written explicitly so the manifest reflects the granted scope.

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

Each plugin contribution in the concatenated response is preceded by a comment that identifies the plugin slug and file, so a reader can attribute a rule to its source. Disabling the plugin drops its contribution on the next `/api/config` request.

### `manifest.scripts[]`

An array of relative paths to JavaScript files the plugin contributes to the viewer page. The host reads each file's bytes from the plugin's `assets/` directory and appends them to the response served at `/customjavascript`, so a viewer loads one `<script>` tag covering admin and plugin contributions.

The same per-entry rules as `manifest.styles[]` apply to `.js` files. Only `ui.modify` is required because the file is inlined, not served. Delimiter comments identify each plugin slug and file. Every plugin's JavaScript runs in the viewer page's shared global scope, so authors should wrap their script in an IIFE to keep top-level declarations from colliding.

### `manifest.extraPageContent`

An object the plugin contributes to the viewer's extra-content block. The host prepends the resolved HTML to the admin's rendered `extraPageContent` on `/api/config`, so plugin HTML lands above the admin's prose.

```json
{
  "slug": "string (required, identifies the slot, passed to on_page_content)",
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

Each contribution is wrapped with an HTML comment that identifies the plugin slug and file. The admin's content goes through the markdown processor before plugin HTML is prepended. Plugin HTML is left raw so tags and attributes pass through as written.

### `manifest.tabs`

An object of tab slug keys to viewer-page tab definitions. The tabs appear alongside the built-in tabs (Followers, About).

```json
{
  "music": {
    "title": "Music",
    "content": "music.html"
  },
  "stream-info": {
    "title": "Stream Info"
  }
}
```

Validation:

- `ui.modify` permission required.
- `http.serve` is **not** required. Each tab's HTML is inlined into the response, not served at a URL.
- Each key must be a valid slug and is passed to `on_tab_content`.
- `title` must be non-empty and unique within the plugin's tabs.
- When `content` is present, the same path rules as `manifest.extraPageContent.content` apply. It must end in `.html`.

**Static** (`content` present): the host reads the file from `assets/` and inlines its bytes.

**Dynamic** (`content` absent): the host calls `on_tab_content` with `{ slug, user? }` and inlines the returned HTML string.

JSON object order is not significant. The host emits tabs in lexicographic slug order on `GET /api/config` under `pluginTabs[]` as `[{slug, title, html}]` entries. The viewer page maps each entry to a tab whose body renders the inlined HTML. The emitted `slug` is `<plugin-slug>/<tab-slug>` and doubles as the React key.

## Payload types

The schemas below come from the JSON tags and envelope builders in Owncast
core. The sources are `services/plugins/hostfns.go`, `manifest.go`,
`dispatcher.go`, and `server.go`, plus the event translators in
`pluginhost/pluginevents.go` and `services/activitypub/events/`. They describe
the raw values at the Wasm boundary. A `?` means the key may be omitted. SDK
convenience objects may rename methods, but they must encode these keys exactly.

```ts
type JSONValue =
  | null
  | boolean
  | number
  | string
  | JSONValue[]
  | { [key: string]: JSONValue };
```

### Registration and dispatch

```ts
type Manifest = {
  api: string;
  type?: "wasm" | "javascript" | "python";
  name: string;
  slug?: string;
  version: string;
  description?: string;
  bot?: BotConfig;
  subscriptions: Subscriptions;
  commands?: CommandInfo[];
  permissions?: string[];
  config?: { [key: string]: ConfigField };
  admin?: AdminConfig;
  actions?: ActionButton[];
  network?: NetworkConfig;
  styles?: string[];
  scripts?: string[];
  extraPageContent?: ExtraPageContent;
  tabs?: Tab[];
};

type BotConfig = {
  displayName?: string;
};

type Subscription = {
  event: string;
  priority?: number;
};

type Subscriptions = {
  notify?: Subscription[];
  filter?: Subscription[];
};

type CommandInfo = {
  name: string;
  prefix?: string;
  description?: string;
  usage?: string;
  aliases?: string[];
  modOnly?: boolean;
  caseSensitive?: boolean;
  cooldownMs?: number;
};

type ConfigField = {
  type: string;
  default?: JSONValue;
  description?: string;
};

type AdminConfig = {
  pages?: AdminPage[];
};

type AdminPage = {
  title: string;
  path: string;
  icon?: string;
};

type NetworkConfig = {
  allowedHosts?: string[];
};

type ActionButton = {
  title: string;
  url?: string;
  html?: string;
  icon?: string;
  color?: string;
  description?: string;
  openExternally?: boolean;
};

type ExtraPageContent = {
  slug: string;
  content?: string;
};

type Tab = {
  title: string;
  slug: string;
  content?: string;
};

type Envelope = {
  eventType: string;
  payload: JSONValue;
};

type FilterResult =
  | { action: "pass" }
  | { action: "modify"; payload: JSONValue }
  | { action: "drop"; reason?: string };
```

`type` is derived by the host from the packaged code filename. Authors do not
set it. The SDK derives `subscriptions` and `commands` in `register`.

### Users and chat

```ts
type User = {
  id: string;
  displayName: string;
  displayColor: number;
  previousNames?: string[];
  createdAt?: string;
  disabledAt?: string;
  scopes?: string[];
  isBot?: boolean;
  isAuthenticated?: boolean;
};

type ChatMessage = {
  id: string;
  user?: User;
  clientId?: number;
  body: string;
  timestamp: string;
};

type ChatClient = {
  id: number;
  userId?: string;
  displayName?: string;
  connectedAt?: string;
  userAgent?: string;
  ipAddress?: string;
  messageCount: number;
};

type ChatUserRename = {
  user: User;
  previousName: string;
};

type ChatMessageModeration = {
  messageId: string;
  visible: boolean;
  moderator?: User;
};

type CommandEvent = {
  message: ChatMessage;
  command: string;
  invokedAs: string;
  args: string[];
  argString: string;
};

type UserRegisterRequest = {
  authId: string;
  displayName?: string | null;
  scopes?: string[];
  profileUrl?: string;
  handle?: string;
  public?: boolean;
};

type UserRegisterResult =
  | { userId: string; error?: never }
  | { userId?: never; error: string };

type GrantSessionRequest = {
  userId: string;
  ttl?: number;
};

type AuthResult = {
  error?: string;
};
```

`profileUrl`, `handle`, and `public` describe a verified external identity.
The host accepts an empty `profileUrl` or an absolute HTTP(S) URL. It stores the
identity for public display only when `public` is true.

### HTTP and authentication exports

```ts
type IncomingHttpRequest = {
  method: string;
  path: string;
  query: { [key: string]: string };
  headers: { [key: string]: string };
  body: string;
  remoteAddr: string;
  authenticated: boolean;
  user?: User;
};

type OutgoingHttpResponse = {
  status?: number;
  headers?: { [key: string]: string };
  body?: string;
};

type ContentRequest = {
  slug: string;
  user?: User;
};

type AuthCheckRequest = {
  user: User;
};

type AuthCheckResult =
  | { action: "ok" }
  | { action: "refresh"; ttl?: number }
  | { action: "deny"; reason?: string };
```

The host always supplies every non-optional `IncomingHttpRequest` key. It
omits `user` for anonymous viewers and admin-only authentication. A missing or
zero response status defaults to 200.

### Stream and server data

```ts
type StreamLifecycleEvent = {
  startedAt?: string;
  stoppedAt?: string;
  title?: string;
  summary?: string;
};

type StreamTitleChange = {
  from: string;
  to: string;
};

type StreamInfo = {
  online: boolean;
  title?: string;
  summary?: string;
  viewers: number;
  startedAt?: string;
  latencyLevel?: number;
};

type StreamBroadcaster = {
  remoteAddr?: string;
  codecs?: string[];
  resolution?: string;
  framerate?: number;
  bitrates?: number[];
};

type ServerInfo = {
  name?: string;
  url?: string;
  summary?: string;
  welcomeMessage?: string;
  version?: string;
};

type SocialHandle = {
  platform: string;
  url: string;
  icon?: string;
};

type Emote = {
  name: string;
  url: string;
};

type FederationInfo = {
  enabled: boolean;
  username?: string;
  isPrivate?: boolean;
};

type AutoplayMode = "off" | "always" | "sound-only";

type VideoCodec =
  | "libx264"
  | "h264_omx"
  | "h264_vaapi"
  | "h264_qsv"
  | "h264_nvenc"
  | "h264_v4l2m2m"
  | "h264_videotoolbox";

type StreamVariant = {
  width: number;
  height: number;
  framerate: number;
  videoBitrate: number;
  cpuUsageLevel: number;
  isPassthrough: boolean;
};

type VideoConfig = {
  latencyLevel: number;
  codec: string;
  autoplay: AutoplayMode;
  variants: StreamVariant[];
};

type VideoConfigUpdate = {
  latencyLevel?: number;
  codec?: VideoCodec;
  autoplay?: AutoplayMode;
  variants?: StreamVariant[];
};
```

`VideoConfig.codec` can report a legacy value or an encoder added by a newer
host. `VideoConfigUpdate.codec` accepts the `VideoCodec` values listed above.

`cpuUsageLevel` accepts `0` through `4`, from lowest to highest CPU usage.
Audio settings are not exposed. A variant update preserves the host's existing
audio configuration for that output.
Hardware codecs require the matching encoder in the host's ffmpeg build.

### Fediverse and notifications

```ts
type FediverseActor = {
  name: string;
  handle: string;
  url?: string;
  image?: string;
};

type FediverseTarget = {
  url: string;
};

type FediverseEngagement = {
  actor: FediverseActor;
  target?: FediverseTarget;
};

type FediverseAttachment = {
  url: string;
  mediaType: string;
  alt?: string;
};

type FediverseInboundPost = {
  actor: FediverseActor;
  content: string;
  contentText: string;
  url: string;
  postedAt: string;
  inReplyTo?: string;
  attachments?: FediverseAttachment[];
  language?: string;
};

type FediverseQuote = {
  actor: FediverseActor;
  target: FediverseTarget;
  content?: string;
  contentText?: string;
  url: string;
  postedAt?: string;
  inReplyTo?: string;
  attachments?: FediverseAttachment[];
  language?: string;
};

type BrowserPushPayload = {
  title: string;
  body?: string;
  url?: string;
};

type FediversePayload = {
  type: string;
  body: string;
  image?: string;
  link?: string;
};
```

`fediverse.activity` carries the verified ActivityPub object as an unrestricted
`JSONValue`. Follow carries `FediverseEngagement` without `target`. Like and
repost carry it with `target`. Quote carries `FediverseQuote`. Mention and
reply carry `FediverseInboundPost`.

### Storage and remaining host results

```ts
type UploadResult = {
  url: string;
};

type FsResult = {
  ok: boolean;
  error?: string;
};

type SQLValue = null | boolean | number | string;

type SQLRequest = {
  sql: string;
  params?: SQLValue[];
  maxRows?: number;
};

type SQLExecResult = {
  ok: boolean;
  error?: string;
  rowsAffected: number;
  lastInsertId: number;
};

type SQLQueryResult = {
  ok: boolean;
  error?: string;
  columns: string[];
  rows: SQLValue[][];
  truncated?: boolean;
};

type SSEConnectionEvent = {
  channel: string;
  connectionId: number;
  user?: User;
};

type TickEvent = {
  now: number;
};

type TimerFireEvent = {
  id: number;
};
```

SQL integer fields are signed 64-bit values in core. Chat client IDs, SSE
connection IDs, and timer IDs are unsigned 64-bit values. JavaScript exposes
all of them as `number`, which loses integer precision above
`Number.MAX_SAFE_INTEGER`.

### Event payload map

| Event | `Envelope.payload` |
| --- | --- |
| `chat.message.received` | `ChatMessage` |
| `chat.user.joined`, `chat.user.parted` | `User` |
| `chat.user.renamed` | `ChatUserRename` |
| `chat.message.moderated` | `ChatMessageModeration` |
| `chat.command` | `CommandEvent` |
| `stream.started`, `stream.stopped` | `StreamLifecycleEvent` |
| `stream.title.changed` | `StreamTitleChange` |
| `sse.connect`, `sse.disconnect` | `SSEConnectionEvent` |
| `tick` | `TickEvent` |
| `timer.fire` | `TimerFireEvent` |
| `fediverse.activity` | `JSONValue` |
| `fediverse.follow`, `fediverse.like`, `fediverse.repost`, `fediverse.quote` | `FediverseEngagement` |
| `fediverse.mention`, `fediverse.reply` | `FediverseInboundPost` |
| Custom event name | `JSONValue` |

## Conformance

Each language SDK is responsible for:

- Declaring every import above in the shared engine.
- Encoding each pointer as the documented JSON, UTF-8 string, or raw bytes.
- Using `I64` for every scalar input and output.
- Dispatching all nine exports with the documented input and output shapes.

The Owncast runtime registers each custom import under `extism:host/user`,
checks its permission, and handles the documented stack shape. Owncast's
`services/plugins/contract_test.go` snapshots permission names, host-function
names, and wire-type fields. This SDK's
`host-runtime/host_function_contract_test.go` derives the current names and
stack signatures from `plugins.BuildHostFunctions(&plugins.HostEnv{})`, then
compares both shared engine declaration files.
