# Owncast Plugin Wire Protocol

The contract between the Owncast host runtime and a plugin. This document is the source of truth that every language SDK (and the host implementation in the Owncast server repo) implements.

## Overview

A plugin is a WebAssembly module exposing four well-known exports and (conditionally) importing a fixed set of host functions. Communication is single-buffer in / single-buffer out at the wasm ABI: the host writes a JSON or text body before the call, the plugin reads it via the Extism `Host.input*()` helpers, and any return value is written via `Host.output*()`.

## Exports (plugin → host)

Every plugin must export these four functions:

| Function | Input | Output | Purpose |
|---|---|---|---|
| `register` | none | JSON `Manifest` | Returns the plugin's subscriptions for the host to compare against the static `plugin.manifest.json`. |
| `on_event` | JSON `Envelope` | none | Notification dispatch. Fire-and-forget. |
| `on_filter` | JSON `Envelope` | JSON `FilterResult` | Filter chain entry point. |
| `on_http_request` | JSON `IncomingHttpRequest` | JSON `OutgoingHttpResponse` | HTTP request handler for `/plugins/<name>/*`. |

Each entry point has a per-call timeout enforced by the host. See the host's `dispatcher.go` and `server.go` for current values.

## Imports (host → plugin)

Host functions are wired in conditionally based on the manifest's declared permissions. A plugin that doesn't declare a permission won't see the matching imports — calling a wrapper that needs an absent import throws a clear error in the SDK.

### `chat.send`
- `owncast_send_chat(textPtr: PTR): void` — plugin's bot identity, regular message
- `owncast_send_chat_action(textPtr: PTR): void` — same identity, "/me" action style
- `owncast_send_chat_system(bodyPtr: PTR): void` — no user identity, body rendered as HTML
- `owncast_send_chat_to(clientId: I64, textPtr: PTR): void` — private DM to one client

### `chat.history`
- `owncast_chat_history(limit: I32): PTR` — returns JSON `ChatMessage[]`
- `owncast_chat_clients(): PTR` — returns JSON `ChatClient[]`

### `chat.moderate`
- `owncast_delete_message(idPtr: PTR): void`
- `owncast_kick_client(clientId: I64): void`

### `storage.kv`
- `owncast_kv_get(keyPtr: PTR): PTR` — returns text or 0-offset on miss
- `owncast_kv_set(keyPtr: PTR, valPtr: PTR): void`

### `storage.upload`
- `owncast_storage_upload(namePtr: PTR, dataPtr: PTR): PTR` — returns JSON `{url}` or 0-offset on failure

### `events.emit`
- `owncast_emit_event(eventTypePtr: PTR, payloadPtr: PTR): void` — payload is a JSON-encoded value

### `server.read`
- `owncast_stream_current(): PTR` — JSON `StreamInfo`
- `owncast_server_info(): PTR` — JSON `ServerInfo`
- `owncast_server_socials(): PTR` — JSON `SocialHandle[]`
- `owncast_server_federation(): PTR` — JSON `FederationInfo`

### `notifications.send`
- `owncast_notify_discord(textPtr: PTR): void`
- `owncast_notify_browser_push(payloadPtr: PTR): void` — JSON `BrowserPushPayload`
- `owncast_notify_fediverse(payloadPtr: PTR): void` — JSON `FediversePayload`

### `users.read`
- `owncast_users_list(): PTR` — JSON `User[]`
- `owncast_user_get(idPtr: PTR): PTR` — JSON `User` or 0-offset on miss

### `users.moderate`
- `owncast_user_set_enabled(idPtr: PTR, enabled: I32, reasonPtr: PTR): void`
- `owncast_ban_ip(ipPtr: PTR): void`

### `fediverse.post`
- `owncast_fediverse_post(textPtr: PTR): PTR` — JSON `{url}` or 0-offset on failure

### `network.fetch`
- Not a custom host function — grants the plugin access to Extism's built-in `Http.request`. The host configures Extism's `AllowedHosts` from the manifest's `network.allowedHosts` (see [Manifest extensions](#manifest-extensions) below). Manifests granting `network.fetch` without `network.allowedHosts` are rejected at load.

### `http.serve`
- Not a host function. Grants the host's HTTP server permission to route `/plugins/<name>/*` requests to this plugin's `on_http_request` export and to serve static assets from its `assets/` directory.

## Manifest extensions

The plugin manifest carries a few host-facing declarations beyond identity and permissions. The host parses these at load time; they don't ride over wasm.

### `manifest.actions[]`

An array of `ActionButton` entries the host merges into Owncast's external-action list while the plugin is enabled. Shape matches Owncast's `ExternalAction`:

```json
{
  "title": "string (required)",
  "url": "string (URL or relative path; mutually exclusive with html)",
  "html": "string (raw HTML; mutually exclusive with url)",
  "icon": "string (URL)",
  "color": "string (hex)",
  "description": "string",
  "openExternally": false
}
```

Host validation:
- `title` required; exactly one of `url` or `html` required.
- Relative URLs starting with `/` but not `/plugins/` are rewritten to `/plugins/<plugin-name>/<path>`.
- URLs resolving into the plugin's own namespace require `http.serve`; load fails otherwise.
- URLs pointing at another plugin's namespace are rejected at load.

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

A drift test in each repo asserts its host-fn registrations match the names in this doc. See `host-runtime-poc/plugin/sdk_drift_test.go` for the PoC version.
