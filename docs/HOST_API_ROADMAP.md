# Host API Roadmap

Catalog of Owncast capabilities the plugin runtime should eventually expose, distilled from a survey of `~/src/owncast`. Each entry maps a real Go API to the plugin-facing host function or event it would back.

The goal is to drive plugins toward typed, first-class capabilities (`owncast.stream.current()`, `onStreamStarted`) rather than reaching back to localhost HTTP. Anything in this document that's not yet exposed is fair game for a plugin to request via `owncast.http.fetch("http://localhost:.../api/...")` for now — but each common use case is a candidate to promote to a real host function.

Status legend:
- ✅ shipped in the PoC
- 🟡 planned next; design is settled
- ⚪ deferred / open question

---

## 1. Stream lifecycle

Events plugins can subscribe to:

| Event | Payload | Backed by | Status |
|---|---|---|---|
| `stream.started` | `{startedAt, title, summary}` | `webhooks.go` `StreamStarted` event | ✅ |
| `stream.stopped` | `{stoppedAt, durationSeconds}` | `webhooks.go` `StreamStopped` event | ✅ |
| `stream.title.changed` | `{from, to}` | `webhooks.go` `StreamTitleUpdated` event | ✅ |

Typed handlers in the SDK: `onStreamStarted(info)`, `onStreamStopped(info)`, `onStreamTitleChanged(change)` — all shipped.

Read APIs:

| API | Returns | Backed by | Status |
|---|---|---|---|
| `owncast.stream.current()` | `{online, title, viewers, startedAt, latencyLevel}` | `core.GetStatus()` in `core/status.go` | ✅ |
| `owncast.stream.broadcaster()` | `{remoteAddr, codecs, resolution, framerate, bitrates}` | `core.GetBroadcaster()` | ⚪ |
| `owncast.stream.variants()` | `[{width, height, framerate, videoBitrate, audioBitrate, isPassthrough}]` | `core.GetCurrentBroadcast().OutputSettings` | ⚪ |

## 2. Chat

| Capability | Status | Notes |
|---|---|---|
| Receive messages — `onChatMessage(msg)` | ✅ | |
| Filter messages — `filterChatMessage(msg)` | ✅ | |
| Send as system — `owncast.chat.send(text)` | ✅ | Backed by `chat.SendSystemMessage`. Posts as plugin's auto-bot identity. |
| Send as named bot — `owncast.chat.sendAs(name, text)` | ❌ removed | Replaced by the simpler model — one chat identity per plugin (the auto-bot). For multiple personas, ship multiple plugins. |
| Send action — `owncast.chat.sendAction(text)` | ✅ | `chat.SendSystemAction` |
| Delete message — `owncast.chat.deleteMessage(id)` | ✅ | `chat.SetMessagesVisibility([id], false)` — needs `chat.moderate` |
| Recent history — `owncast.chat.history(limit?)` | ✅ | `chatmessagerepository` query — needs `chat.history` |
| Disconnect clients — `owncast.chat.kick(clientId)` | ✅ | `chat.DisconnectClients` — needs `chat.moderate` |
| List clients — `owncast.chat.clients()` | ✅ | `chat.GetClients()` — needs `chat.history` |
| Send to one client — `owncast.chat.sendTo(clientId, text)` | ✅ | `chat.SendSystemMessageToClient` |

Native chat events to plumb through (these all already exist as webhooks):

| Event | Backed by | Status |
|---|---|---|
| `chat.message.received` | `MessageSent` webhook | ✅ |
| `chat.user.joined` | `UserJoined` webhook | ✅ |
| `chat.user.parted` | `UserParted` webhook | ✅ |
| `chat.user.renamed` | `UserNameChanged` webhook | ✅ |
| `chat.message.moderated` | `VisibiltyToggled` webhook | ✅ |

## 3. Users and moderation

The User model (`models/user.go`) has stable UUID `ID`, `DisplayName` (mutable), `PreviousNames`, `Scopes` (e.g. `MODERATOR`), `IsBot`, `IsAuthenticated`, `DisabledAt`. Authoritative across reconnects.

| API | Backed by | Status |
|---|---|---|
| `owncast.users.get(id)` | `userrepository.GetUserByToken` etc. | ✅ |
| `owncast.users.list()` | `userrepository` queries | ✅ |
| `owncast.users.setEnabled(id, enabled, reason?)` | `chat.SetUserEnabled` | ✅ |
| `owncast.users.banIP(ip)` | `authrepository.BanIPAddress` | ✅ |

Read methods behind `users.read`; mutating methods behind `users.moderate`.

## 4. Server / config (read-only)

`ConfigRepository` exposes a lot of getters. The plugin-relevant subset:

| API | Returns | Status |
|---|---|---|
| `owncast.server.info()` | `{name, url, summary, welcomeMessage, version}` | ✅ |
| `owncast.server.socials()` | `[{platform, url, icon}]` | ✅ |
| `owncast.server.federation()` | `{enabled, username, isPrivate}` | ✅ |
| `owncast.server.streamConfig()` | `{title, latencyLevel, codec}` | ⚪ |
| `owncast.server.tags()` | `[string]` | ⚪ |

Plugins do **not** get write access to server config. Plugin's own config (per-plugin) is a separate per-plugin namespaced thing — handled via `manifest.config` and a future `owncast.config.get(key)` host function with admin-set values.

## 5. Notifications and external integrations

| API | Backed by | Status |
|---|---|---|
| `owncast.notifications.discord(text)` | Existing Discord webhook config | ✅ |
| `owncast.notifications.browserPush({title, body, url?})` | Existing browser push config | ✅ |
| `owncast.notifications.fediverse({type, body, image?, link?})` | `chat.SendFediverseAction` | ✅ |

Behind a single `notifications.send` permission. Each backend honors its own enabled-flag from server config; plugin doesn't bypass admin opt-out.

## 6. Federation

| Event | Status |
|---|---|
| `fediverse.follow` | ✅ |
| `fediverse.like` | ✅ |
| `fediverse.repost` | ✅ |
| `fediverse.mention` | ✅ |
| `fediverse.reply` | ✅ |

Typed handlers in the SDK: `onFediverseFollow/Like/Repost` (engagement metadata only) + `onFediverseMention/Reply` (inbound posts that include content). Owncast-side wiring needs the ActivityPub inbox handler (`activitypub/inbox/`) to dispatch typed events when it processes incoming `Create`/`Note` activities targeting the streamer.

Outbound fediverse — `owncast.fediverse.post(text)` — is shipped. Text-only, public-visibility only, no replies/boosts/blocks/attachments (those expand the trust surface significantly; defer until specific use cases demand them). Gated behind a dedicated `fediverse.post` permission. Host rate-limits at 5 posts/hour per plugin (default; admin can tune). The kill-switch for the whole feature is whatever Owncast's existing "federation enabled" toggle reads.

## 7. Storage and uploads

KV already exposed (✅). For larger blobs:

| API | Backed by | Status |
|---|---|---|
| `owncast.storage.upload(name, bytes)` → `{url}` | Owncast's `StorageProvider` (local or S3) | ✅ |

A plugin uploading an image gets a URL that points either at the local Owncast server or at the configured S3 bucket — Owncast handles the abstraction.

## 8. Auth context

The PoC's `req.authenticated` is currently always `false`. In production it should reflect Owncast's auth middleware:

- `RequireAdminAuth` — HTTP Basic Auth (username `admin`, bcrypt-hashed password)
- `RequireUserAccessToken` — `?accessToken=...` validates against user table
- `RequireUserModerationScopeAccesstoken` — same plus `MODERATOR` scope

Plugin requests should arrive with:

```ts
interface IncomingHttpRequest {
  // ... existing
  authenticated: boolean;     // any auth (admin OR user token)
  user?: {
    id: string;
    displayName: string;
    scopes: string[];          // includes "MODERATOR" if applicable
    isAuthenticated: boolean;
    isBot: boolean;
  };
  isAdmin: boolean;            // admin Basic Auth specifically
}
```

This is the wiring step when integrating with real Owncast — no new host functions needed.

## 9. HTTP layer integration

Real Owncast already mounts routes under `/api/` via chi. The plugin server (`owncast/plugin/server.go`) should be mounted at `/plugins/` in Owncast's existing chi router:

```go
mux.Handle("/plugins/", pluginServer)
```

That's the only integration point. No CORS or middleware changes needed; plugins inherit Owncast's middleware stack.

## 10. Storage / database

Plugins do not touch Owncast's SQLite directly. The KV namespace they get (currently bbolt-backed) is logically separate. When integrating into real Owncast, the `kv.Store` interface implementation might switch to a SQLite-backed namespace alongside Owncast's existing tables, or stay on bbolt — implementation detail invisible to plugins.

## 11. Deferred capabilities

- **Transcoder/HLS state** — admin-only domain, not plugin-relevant
- **Direct DB access** — intentionally not exposed
- **Cross-plugin data access** — plugins are namespace-isolated; if two plugins need to share data, they emit/subscribe to custom events

## 12. Permission grouping

Today's permissions: `chat.send`, `chat.history`, `chat.moderate`, `storage.kv`, `storage.upload`, `events.emit`, `network.fetch`, `http.serve`, `server.read`, `notifications.send`, `users.read`, `users.moderate`. Anticipated additions: any new capability that lands gets its own permission to keep manifest review surfaces honest.

Manifest declares the union it needs; admin reviews at install time.
