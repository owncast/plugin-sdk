# Owncast Plugin Wire Protocol

The contract between the Owncast host runtime and a plugin. This document is the source of truth that every language SDK (and the host implementation in the Owncast server repo) implements.

## Overview

A plugin is a WebAssembly module exposing four well-known exports and (conditionally) importing a fixed set of host functions. Communication is single-buffer in / single-buffer out at the wasm ABI: the host writes a JSON or text body before the call, the plugin reads it via the Extism `Host.input*()` helpers, and any return value is written via `Host.output*()`.

## Exports (plugin → host)

Every plugin must export these four functions:

| Function          | Input                      | Output                      | Purpose                                                                                               |
| ----------------- | -------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `register`        | none                       | JSON `Manifest`             | Returns the plugin's subscriptions for the host to compare against the static `plugin.manifest.json`. |
| `on_event`        | JSON `Envelope`            | none                        | Notification dispatch. Fire-and-forget.                                                               |
| `on_filter`       | JSON `Envelope`            | JSON `FilterResult`         | Filter chain entry point.                                                                             |
| `on_http_request` | JSON `IncomingHttpRequest` | JSON `OutgoingHttpResponse` | HTTP request handler for `/plugins/<name>/*`.                                                         |

Each entry point has a per-call timeout enforced by the host. See the host's `dispatcher.go` and `server.go` for current values.

## Imports (host → plugin)

Host functions are wired in conditionally based on the manifest's declared permissions. A plugin that doesn't declare a permission won't see the matching imports, calling a wrapper that needs an absent import throws a clear error in the SDK.

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

### `events.emit`

- `owncast_emit_event(eventTypePtr: PTR, payloadPtr: PTR): void`, payload is a JSON-encoded value

### `server.read`

- `owncast_stream_current(): PTR`, JSON `StreamInfo`
- `owncast_stream_broadcaster(): PTR`, JSON `StreamBroadcaster` (read-only inbound-feed telemetry)
- `owncast_server_info(): PTR`, JSON `ServerInfo`
- `owncast_server_socials(): PTR`, JSON `SocialHandle[]`
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

- Not a host function. Grants the host's HTTP server permission to route `/plugins/<name>/*` requests to this plugin's `on_http_request` export and to serve static assets from its `assets/` directory.

### `http.sse`

- `owncast_sse_send(channelPtr: PTR, eventPtr: PTR, dataPtr: PTR): void`, push one Server-Sent-Events message to every browser connected to `(this plugin, channel)`. `channel` and `event` are plain strings; `data` is the message body (the SDK JSON-encodes non-string values). Fire-and-forget: the call returns immediately and never blocks on a slow or absent client.
- Grants the host permission to serve the reserved `/plugins/<name>/_sse/<channel>` endpoint (see [Host-reserved endpoints](#host-reserved-endpoints)). Independent of `http.serve`: a plugin may stream events without serving any other routes.

### `ui.modify`

- Not a custom host function. Gates UI surfaces that place plugin-contributed elements inside Owncast's own chrome.
- Required when the manifest declares `actions[]`, and required at runtime by `owncast_add_actions` / `owncast_clear_actions`. Manifests that declare `actions[]` without `ui.modify` are rejected at load; runtime calls return a permission error.
- `owncast_add_actions(jsonPtr: PTR): u64`, append one or more `ActionButton` entries on top of `manifest.actions`. Argument is a JSON array; the host validates each entry with the same rules as the manifest (title required, exactly one of `url` / `html`, relative URLs and icons auto-prefixed to the plugin's namespace, cross-plugin paths rejected) and persists the merged set to the plugin's config. Returns the host call envelope (success indicator + optional error string).
- `owncast_clear_actions(jsonPtr: PTR): u64`, drop every runtime addition. `manifest.actions` are untouched. Argument is an empty JSON object (`"{}"`) for API symmetry; returns the host call envelope.

### `chat.filter`

- Not a custom host function. Gates the `filter_chat_message` export: a plugin that registers a `filterChatMessage` handler must declare this permission at load time, otherwise the host rejects the manifest.
- This is deliberately separate from `chat.send`, `chat.history`, and `chat.moderate`: filtering happens inline on every chat message before broadcast (modify the body, drop the message, or pass it through), so the manifest reviewer needs to see it called out explicitly.

## Host-reserved endpoints

These paths under `/plugins/<name>/` are owned by the host. The plugin's `on_http_request` never sees them; they cannot be overridden by a plugin's own routes.

### `GET /api/plugins/<name>/icon`

Returns the raw bytes of the plugin's `icon.png` if one was bundled at the root of the `.ocpkg` (or sits next to the `.wasm` as `<base>.icon.png` for the loose-files layout). 404 when no icon is present. No `http.serve` permission required: this is a host endpoint, served independently of the plugin's own routes, so a plugin that ships an icon for the admin UI doesn't need any HTTP surface of its own. Returned with `Content-Type: image/png` and `Cache-Control: no-cache` so a swapped icon shows up on the next admin reload.

### `GET /api/admin/plugins/<name>/instructions`

Returns the raw markdown of the plugin's `INSTRUCTIONS.md` if one was bundled at the root of the `.ocpkg` (or sits next to the `.wasm` as `<base>.INSTRUCTIONS.md` for the loose-files layout). 404 when none is present. Admin-authenticated, since it's part of the plugin-management API rather than a public asset. No `http.serve` permission required. Returned with `Content-Type: text/markdown` and `Cache-Control: no-cache` so swapped instructions show up on the next admin reload; the admin UI renders the markdown in an **Instructions** tab on the plugin's details page.

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

## Payload types

The JSON shapes for `Manifest`, `Envelope`, `ChatMessage`, `FediverseInboundPost`, etc. are documented in the JS SDK's `index.d.ts` as TypeScript interfaces. Future SDKs (Go, Python) port these shapes into their native type system; the over-the-wire JSON is identical.

## Conformance

Each language SDK is responsible for:

- Declaring the imports listed above (gated by manifest permissions) so the plugin author's call into `owncast.chat.send(...)` resolves to the right wasm import.
- Encoding/decoding payloads as JSON or text per the table above.
- Implementing the four exports' dispatch loop: parse the envelope, route to the right handler, serialize the response.

The Owncast server repo's plugin runtime is responsible for:

- Registering each host function under the right Extism namespace and permission gate.
- Calling exports with the right input shapes and observing the documented timeout / size caps.

A drift test in each repo asserts its host-fn registrations match the names in this doc. See `host-runtime/plugin/sdk_drift_test.go` for the PoC version.
