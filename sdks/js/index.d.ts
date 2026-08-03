/**
 * Built-in chat message payload (`chat.message.received` and the chat filter).
 *
 * `user` carries the full sender identity. Use `user.id` for stable per-user
 * state and `user.scopes` (e.g. `"MODERATOR"`) for reliable, non-spoofable
 * moderation gating rather than matching on the display name. `clientId`
 * identifies the originating connection. Pass it to `owncast.chat.sendTo` (or
 * `owncast.chat.replyTo(msg, …)`) to whisper a reply back to the sender.
 *
 * `user` is undefined for the rare message with no associated account.
 */
export interface ChatMessage {
  id: string;
  user?: User;
  clientId?: number;
  body: string;
  timestamp: string;
}

/** Payload of `chat.user.renamed`, the same user changing their name. */
export interface ChatUserRename {
  user: User;
  previousName: string;
}

/** Payload of `chat.message.moderated`, a message hidden/restored by a mod. */
export interface ChatMessageModeration {
  messageId: string;
  visible: boolean;
  moderator?: User;
}

/** Stream-lifecycle payloads. */
export interface StreamLifecycleEvent {
  startedAt?: string; // ISO-8601, set for stream.started
  stoppedAt?: string; // ISO-8601, set for stream.stopped
  title?: string;
  summary?: string;
}

export interface StreamTitleChange {
  from: string;
  to: string;
}

/** What owncast.stream.current() returns. */
export interface StreamInfo {
  online: boolean;
  title?: string;
  summary?: string;
  viewers: number;
  startedAt?: string;
  latencyLevel?: number;
}

/** What owncast.server.info() returns. */
export interface ServerInfo {
  name?: string;
  url?: string;
  summary?: string;
  welcomeMessage?: string;
  version?: string;
}

/** What owncast.stream.broadcaster() returns. Empty when offline. */
export interface StreamBroadcaster {
  remoteAddr?: string;
  codecs?: string[];
  resolution?: string;
  framerate?: number;
  bitrates?: number[];
}

/** One configured output rendition, part of VideoConfig (owncast.videoConfig). */
export interface StreamVariant {
  width: number;
  height: number;
  framerate: number;
  videoBitrate: number;
  audioBitrate: number;
  isPassthrough: boolean;
}

/** The current video/transcoding config returned by owncast.videoConfig.read(). */
export interface VideoConfig {
  latencyLevel: number;
  codec: string;
  variants: StreamVariant[];
}

/** Partial video config passed to owncast.videoConfig.write(). Omitted fields
 *  are left unchanged. */
export interface VideoConfigUpdate {
  latencyLevel?: number;
  codec?: string;
  variants?: StreamVariant[];
}

export const FilterAction: {
  readonly Pass: "pass";
  readonly Modify: "modify";
  readonly Drop: "drop";
};
export type FilterAction = (typeof FilterAction)[keyof typeof FilterAction];

export type FilterResult =
  | { action: typeof FilterAction.Pass }
  | { action: typeof FilterAction.Modify; payload: any }
  | { action: typeof FilterAction.Drop; reason?: string };

export const Events: {
  readonly ChatMessageReceived: "chat.message.received";
  readonly ChatUserJoined: "chat.user.joined";
  readonly ChatUserParted: "chat.user.parted";
  readonly ChatUserRenamed: "chat.user.renamed";
  readonly ChatMessageModerated: "chat.message.moderated";
  readonly StreamStarted: "stream.started";
  readonly StreamStopped: "stream.stopped";
  readonly StreamTitleChanged: "stream.title.changed";
  readonly SseConnect: "sse.connect";
  readonly SseDisconnect: "sse.disconnect";
  readonly Tick: "tick";
  readonly FediverseActivity: "fediverse.activity";
  readonly FediverseFollow: "fediverse.follow";
  readonly FediverseLike: "fediverse.like";
  readonly FediverseRepost: "fediverse.repost";
  readonly FediverseQuote: "fediverse.quote";
  readonly FediverseMention: "fediverse.mention";
  readonly FediverseReply: "fediverse.reply";
};

/** Payload shape for fediverse engagement events. */
export interface FediverseActor {
  name: string;
  handle: string; // e.g. "@alice@fediverse.example"
  url?: string;
  image?: string;
}

export interface FediverseEngagement {
  actor: FediverseActor;
  /** For likes, reposts, and quotes: the target object URL. Not set for follows. */
  target?: { url: string };
}

export interface FediverseTargetedEngagement extends FediverseEngagement {
  target: { url: string };
}

/** An accepted quote request. `target` identifies the local post being quoted,
 *  while `url` identifies the remote quote post. Content metadata is present
 *  when the requesting server embeds the quote Note in its request. */
export interface FediverseQuote extends FediverseTargetedEngagement {
  content?: string; // HTML from the source instance
  contentText?: string; // HTML stripped to plain text
  url: string; // permalink to the remote quote post
  postedAt?: string; // ISO-8601
  inReplyTo?: string;
  attachments?: {
    url: string;
    mediaType: string;
    alt?: string;
  }[];
  language?: string;
}

/** Inbound fediverse post, a mention or reply that contains content the
 *  plugin can act on. Carries both the rendered content (which has the
 *  source instance's HTML) and a plain-text version (HTML stripped). */
export interface FediverseInboundPost {
  actor: FediverseActor;
  content: string; // HTML from the source instance
  contentText: string; // HTML stripped to plain text
  url: string; // permalink to the post on its source
  postedAt: string; // ISO-8601
  inReplyTo?: string; // parent post URL, when this is a reply
  attachments?: {
    url: string;
    mediaType: string;
    alt?: string;
  }[];
  language?: string;
}

export const Permissions: {
  readonly ChatSend: "chat.send";
  readonly ChatHistory: "chat.history";
  readonly ChatModerate: "chat.moderate";
  readonly ChatFilter: "chat.filter";
  readonly StorageKV: "storage.kv";
  readonly StorageUpload: "storage.upload";
  readonly StorageFS: "storage.fs";
  readonly StorageSQL: "storage.sql";
  readonly EventsEmit: "events.emit";
  readonly NetworkFetch: "network.fetch";
  readonly HttpServe: "http.serve";
  readonly ServerRead: "server.read";
  readonly NotificationsSend: "notifications.send";
  readonly UsersRead: "users.read";
  readonly UsersModerate: "users.moderate";
  readonly UsersRegister: "users.register";
  readonly AuthGate: "auth.gate";
  readonly FediversePost: "fediverse.post";
  readonly FediverseInbound: "fediverse.inbound";
  readonly HttpSSE: "http.sse";
  readonly VideoConfigRead: "videoconfig.read";
  readonly VideoConfigWrite: "videoconfig.write";
  readonly UIModify: "ui.modify";
};

/** Request for `owncast.users.register`. */
export interface UserRegisterRequest {
  /** Stable external identity within this plugin's provider namespace. */
  authId: string;
  /** Optional display name to seed on the user. */
  displayName?: string;
  /** Optional scopes to grant the user (e.g. `["MODERATOR"]`). */
  scopes?: string[];
  /** Verified public profile URL. The host accepts only absolute HTTP(S) URLs. */
  profileUrl?: string;
  /** Label for the verified identity, such as a GitHub login or fediverse handle. */
  handle?: string;
  /** Surface the verified identity publicly only when the viewer opted in. */
  public?: boolean;
}

/** Result of `owncast.users.register`: the resolved Owncast user ID. */
export interface UserRegisterResult {
  userId: string;
}

/** Request for `owncast.auth.grantSession`. */
export interface GrantSessionRequest {
  /** The Owncast user ID returned by `owncast.users.register`. */
  userId: string;
  /** Optional session lifetime in seconds. 0/omitted uses the host default. */
  ttl?: number;
}

export interface BrowserPushPayload {
  title: string;
  body?: string;
  url?: string;
}

export interface FediversePayload {
  type: "follow" | "like" | "repost" | string;
  body: string;
  image?: string;
  link?: string;
}

export interface SocialHandle {
  platform: string;
  url: string;
  icon?: string;
}

/** A custom chat emote from owncast.server.emotes(). */
export interface Emote {
  name: string; // the `:code:` chat clients substitute
  url: string; // image the emote renders to
}

export interface FederationInfo {
  enabled: boolean;
  username?: string;
  isPrivate?: boolean;
}

/** A user. The sender identity carried by every chat payload
 *  (chat.message.received, join/part/rename, moderation) and the record
 *  returned by owncast.users.list() / .get(). `displayColor` is an index into
 *  the instance's configured user-color palette, not a literal color. */
export interface User {
  id: string;
  displayName: string;
  displayColor: number;
  previousNames?: string[];
  createdAt?: string;
  disabledAt?: string; // ISO-8601 if banned, omitted otherwise
  scopes?: string[];
  isBot?: boolean;
  isAuthenticated?: boolean;
}

/** A connected chat client from owncast.chat.clients(). */
export interface ChatClient {
  id: number;
  userId?: string;
  displayName?: string;
  connectedAt?: string;
  userAgent?: string;
  ipAddress?: string;
  messageCount: number;
}

/** Result of owncast.storage.upload(). */
export interface UploadResult {
  url: string;
}

/** Result of a mutating owncast.fs call (write/delete). An empty object means
 *  success. `error` is set when the host rejected the operation. */
export interface FsResult {
  error?: string;
}

/** A value a plugin can bind to a statement parameter, or read back out of a
 *  column. Blobs arrive base64-encoded as strings. */
export type SQLValue = null | boolean | number | string;

/** Result of `owncast.sql.exec`. Absence of `error` means success. Both
 *  counters are SQLite 64-bit integers, so they lose precision in JavaScript
 *  above `Number.MAX_SAFE_INTEGER`. */
export interface SQLExecResult {
  error?: string;
  rowsAffected: number;
  lastInsertId: number;
}

/** One row as `owncast.sql.query` hands it back: column name to value. */
export type SQLRow = Record<string, SQLValue>;

/** The host's raw query response, before the SDK keys rows by column name.
 *  Absence of `error` means success. `rows` holds values in `columns` order,
 *  and `truncated` is set when more rows matched than the caller's row limit. */
export interface SQLQueryResult {
  error?: string;
  columns: string[];
  rows: SQLValue[][];
  truncated?: boolean;
}

export const filter: {
  pass(): FilterResult;
  modify(payload: any): FilterResult;
  drop(reason?: string): FilterResult;
};

/** Request passed to `onAuthCheck`: the host-resolved identity of the viewer
 *  whose session is being re-validated (same `user` shape `onHttpRequest`
 *  receives, and the plugin never re-resolves it). */
export interface AuthCheckRequest {
  user: User;
}

/** Verdict returned from `onAuthCheck`:
 *  - `ok`      keep the session as-is
 *  - `refresh` keep it and re-issue the cookie (optionally with a new `ttl`
 *              in seconds) for sliding-expiry
 *  - `deny`    end the session and bounce the viewer back to the login screen */
export type AuthCheckResult =
  | { action: "ok" }
  | { action: "refresh"; ttl?: number }
  | { action: "deny"; reason?: string };

/** Verdict helpers for `onAuthCheck`. */
export const authCheck: {
  ok(): AuthCheckResult;
  refresh(opts?: { ttl?: number }): AuthCheckResult;
  deny(reason?: string): AuthCheckResult;
};

/** Incoming HTTP request, paths are relative to the plugin's namespace
 *  (i.e. the leading /plugins/<name>/ has been stripped). */
export interface IncomingHttpRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  remoteAddr: string;
  /** True when the request came with any form of Owncast auth (admin OR user). */
  authenticated: boolean;
  /** Identity of the user that made the request, when it came with a
   *  user-token. Undefined for anonymous or admin-only requests. */
  user?: User;
}

export interface OutgoingHttpResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

/** Request context passed to `onTabContent` and `onPageContent` handlers. */
export interface ContentRequest {
  /** The tab or page-content slot's slug, as declared in the manifest. */
  slug: string;
  /** The viewing user's chat identity, when available. Undefined for
   *  anonymous viewers or when the host cannot resolve an identity. */
  user?: User;
}

/** Payload for the sse.connect / sse.disconnect events. Fired when a browser
 *  opens or closes one of the plugin's `/plugins/<name>/_sse/<channel>`
 *  streams, so the plugin can track who is connected. `connectionId` is unique
 *  per connection for the life of the host process, so a disconnect can be
 *  paired with its connect and the same user counted across several tabs.
 *  `user` is present only when the connection carried a chat identity. */
export interface SSEConnectionEvent {
  channel: string;
  connectionId: number;
  user?: User;
}

/** Payload for the once-a-second tick event (onTick). `now` is the host
 *  wall-clock time in unix milliseconds when the tick fired. */
export interface TickEvent {
  now: number;
}

export interface PluginDef {
  /** Declarative chat commands with aliases, moderator gates, and per-user
   *  cooldowns. Command messages also remain available to onChatMessage. */
  commands?: Record<string, CommandDefinition>;
  /** Command prefix for the `commands` table. Default "!". */
  commandPrefix?: string;
  /** Match command names case-sensitively. Default false. */
  commandsCaseSensitive?: boolean;

  /** Notification handler for chat messages. Fire-and-forget. */
  onChatMessage?(msg: ChatMessage): void | Promise<void>;

  /** Filter handler for chat messages. Return filter.pass() / .modify() / .drop().
   *  Errors are treated as filter.pass() (fail-open). */
  filterChatMessage?(msg: ChatMessage): FilterResult;

  /** User connected to chat. */
  onChatUserJoined?(user: User): void | Promise<void>;
  /** User disconnected from chat. */
  onChatUserParted?(user: User): void | Promise<void>;
  /** User changed their display name. */
  onChatUserRenamed?(change: ChatUserRename): void | Promise<void>;
  /** A chat message was hidden or restored by a moderator. */
  onMessageModerated?(event: ChatMessageModeration): void | Promise<void>;

  /** Stream went live. */
  onStreamStarted?(info: StreamLifecycleEvent): void | Promise<void>;
  /** Stream stopped. */
  onStreamStopped?(info: StreamLifecycleEvent): void | Promise<void>;
  /** Stream title was updated. */
  onStreamTitleChanged?(change: StreamTitleChange): void | Promise<void>;

  /** A browser opened one of this plugin's SSE streams. Use it to track who
   *  is connected. Requires the `http.sse` permission. */
  onSseConnect?(event: SSEConnectionEvent): void | Promise<void>;
  /** A browser closed one of this plugin's SSE streams (same connectionId as
   *  the matching onSseConnect). Requires the `http.sse` permission. */
  onSseDisconnect?(event: SSEConnectionEvent): void | Promise<void>;

  /** Fires once a second for periodic work. `now` is the host wall-clock time
   *  in unix milliseconds. Defining this opts the plugin into the tick. */
  onTick?(event: TickEvent): void | Promise<void>;

  /** A verified inbound ActivityPub activity as its raw JSON object. Requires `fediverse.inbound`. */
  onFediverse?(activity: Record<string, unknown>): void | Promise<void>;

  /** Someone on the fediverse followed the streamer's account. Requires `fediverse.inbound`. */
  onFediverseFollow?(event: FediverseEngagement): void | Promise<void>;
  /** Someone on the fediverse liked a streamer post / federated stream announcement. Requires `fediverse.inbound`. */
  onFediverseLike?(event: FediverseTargetedEngagement): void | Promise<void>;
  /** Someone on the fediverse boosted (reposted) a streamer post. Requires `fediverse.inbound`. */
  onFediverseRepost?(event: FediverseTargetedEngagement): void | Promise<void>;
  /** Someone on the fediverse quoted a locally authored post. `target.url` identifies the local post and `url` identifies the remote quote post. Requires `fediverse.inbound`. */
  onFediverseQuote?(event: FediverseQuote): void | Promise<void>;
  /** Someone @-mentioned the streamer in a public post. Requires `fediverse.inbound`. */
  onFediverseMention?(post: FediverseInboundPost): void | Promise<void>;
  /** Someone replied to one of the streamer's federated posts. Requires `fediverse.inbound`. */
  onFediverseReply?(post: FediverseInboundPost): void | Promise<void>;

  /** HTTP request handler. Called for any path under /plugins/<name>/ that
   *  isn't served as a static asset. Default-public, gate admin features
   *  on `req.authenticated` yourself. Requires `http.serve` permission. */
  onHttpRequest?(req: IncomingHttpRequest): OutgoingHttpResponse;

  /** Re-validate a viewer's gate session on page load. Only meaningful for the
   *  active `auth.gate` plugin: the host calls it on the viewer's `/` request
   *  with the resolved `req.user`, and acts on the verdict: `ok` to continue,
   *  `refresh` to extend the session, `deny` to revoke it and force re-login.
   *  Optional. Without it a granted session lasts until its cookie
   *  expires (no mid-session revocation). This is the revocation hook: return
   *  `deny` for users your provider has banned/deleted. Requires `auth.gate`. */
  onAuthCheck?(req: AuthCheckRequest): AuthCheckResult;

  /** Render HTML for a dynamic tab. Called by the host when the tab was
   *  declared in the manifest without a static `content` file. Return the
   *  full HTML string to inline as the tab body. `req.user` is the viewer's
   *  chat identity when available, undefined for anonymous viewers. */
  onTabContent?(req: ContentRequest): string;

  /** Render HTML for the plugin's dynamic extraPageContent slot. Called by
   *  the host when extraPageContent was declared without a static `content`
   *  file. Return the full HTML string to inline into the viewer page.
   *  `req.user` is the viewer's chat identity when available. */
  onPageContent?(req: ContentRequest): string;

  /** Return CSS to inline into the viewer page at request time, the dynamic
   *  counterpart to `manifest.styles`, applied to the whole UI. Called once
   *  per `/api/config` for any plugin holding `ui.modify`. No manifest field
   *  is needed, just export this handler. Return nothing (a bare `return`, or
   *  `""`) to contribute nothing. The output is appended after any static
   *  `manifest.styles` files, so returning only the active override wins
   *  within your plugin's own styles. Plugin styles sit below the admin's
   *  appearance settings, so an admin's explicit colors override yours.
   *  Global (no per-viewer argument) so `/api/config` stays cacheable.
   *  Requires `ui.modify`. */
  onPageStyles?(): string | null | void;

  /** Return JavaScript to append to the viewer page at request time, the
   *  dynamic counterpart to `manifest.scripts`. Called once per `/api/config`
   *  for any plugin holding `ui.modify`. The host wraps each plugin's script
   *  (static and dynamic) in a try/catch so a runtime error can't break other
   *  plugins, but it runs in the shared viewer `window`: wrap your code in an
   *  IIFE to avoid global collisions, and escape any untrusted strings you
   *  embed. Return nothing (a bare `return`, or `""`) to contribute nothing.
   *  Requires `ui.modify`. */
  onPageScripts?(): string | null | void;

  /** Handlers for plugin-emitted custom events. The key is the event type
   *  string (e.g. "announcement.broadcast"). Notifications only, to filter
   *  custom events, additional API will be needed. */
  on?: { [eventType: string]: (payload: any) => void | Promise<void> };

  /** Filter chain priority (lower = earlier). Applies to every filter*
   *  handler this plugin defines. Default 100. */
  filterPriority?: number;
}

export function definePlugin(def: PluginDef): PluginDef;

/** What a command handler receives. */
export interface CommandContext {
  /** The originating chat message. */
  msg: ChatMessage;
  /** The sender (same as `msg.user`). */
  user?: User;
  /** The canonical command name that matched (not the alias used). */
  command: string;
  /** The command name or alias exactly as the sender typed it. */
  invokedAs: string;
  /** Whitespace-split arguments after the command word. */
  args: string[];
  /** The raw argument string (everything after the command word, trimmed). */
  argString: string;
  /** Post a public reply as the plugin's chat bot. */
  reply(text: string): void;
  /** Whisper a reply to the sender, falling back to a public post if their
   *  connection is unknown. */
  replyPrivately(text: string): void;
}

/** One command in a declarative command table. */
export interface CommandDefinition {
  /** Short, human-readable summary shown in command listings. */
  description?: string;
  /** Optional usage/example string, e.g. "!latency <0-4>". */
  usage?: string;
  /** Alternate names that invoke this command. */
  aliases?: string[];
  /** Dispatch only for senders whose scopes include "MODERATOR". */
  modOnly?: boolean;
  /** Non-negative integer milliseconds between invocations per user. */
  cooldownMs?: number;
  /** Invoked when the command runs. */
  run(ctx: CommandContext): void;
}

/** Internal payload for a matched command declaration. */
export interface CommandEvent {
  message: ChatMessage;
  command: string;
  invokedAs: string;
  args: string[];
  argString: string;
}

/** Typed wrappers around the Owncast host. Methods that require a permission
 *  say so in their documentation and throw when it was not declared. */
export const owncast: {
  /** Write a plugin-attributed entry to Owncast's server log. No permission
   *  is required. */
  log: {
    info(message: string): void;
    warning(message: string): void;
    error(message: string): void;
  };
  chat: {
    /** Post as the plugin's own chat bot (display name = the plugin's name). */
    send(text: string): void;
    /** Same identity, but in action style (italic, like IRC "/me"). */
    sendAction(text: string): void;
    /** Post a system message, no user identity, rendered as a server
     *  announcement. The body is rendered as HTML, so the plugin is
     *  responsible for escaping any untrusted content. Same `chat.send`
     *  permission as the other send variants. */
    system(body: string): void;
    /** Private message to one chat client. Requires `chat.send`. */
    sendTo(clientId: number | bigint, text: string): void;
    /** Whisper a reply back to whoever sent a chat message. Pass the
     *  `ChatMessage` from `onChatMessage`/`filterChatMessage` (or a bare
     *  clientId). Returns `false` if the sender's connection is unknown (no
     *  clientId), so callers can fall back to a public `send`. Requires
     *  `chat.send`. */
    replyTo(msg: ChatMessage | number | bigint, text: string): boolean;
    /** Recent chat history (most recent last). Requires `chat.history`.
     *  Default limit is 50. Pass a smaller number to get fewer. */
    history(limit?: number): ChatMessage[];
    /** Hide a chat message by ID. Requires `chat.moderate`. */
    deleteMessage(messageId: string): void;
    /** Disconnect a chat client by its numeric ID. Requires `chat.moderate`. */
    kick(clientId: number | bigint): void;
    /** List currently-connected chat clients. Requires `chat.history`. */
    clients(): ChatClient[];
  };
  /** User directory access. */
  users: {
    /** List all users (active + disabled). Requires `users.read`. */
    list(): User[];
    /** Fetch one user by ID. Requires `users.read`. */
    get(id: string): User | null;
    /** Enable/disable a user, with an optional reason. Requires `users.moderate`. */
    setEnabled(id: string, enabled: boolean, reason?: string): void;
    /** Ban an IP address. Requires `users.moderate`. */
    banIP(ip: string): void;
    /** Find or create an authenticated user for an external identity. The host
     *  scopes `authId` to this plugin's slug. `profileUrl` and `handle`
     *  describe a verified external profile, and `public` opts that identity
     *  into public display. Returns `{ userId }`. Throws on host error.
     *  Requires `users.register`. */
    register(opts: UserRegisterRequest | string): UserRegisterResult;
  };
  /** Viewer-authentication gate. Only a plugin holding `auth.gate` (and enabled
   *  by an admin) can issue sessions, and only inside `onHttpRequest`, where the
   *  host attaches or clears the signed session cookie on the response. The
   *  admin selects the cumulative, host-owned access mode. Plugins cannot read
   *  or change it. */
  auth: {
    /** Issue a gate session for an already-registered user (see
     *  `users.register`). `ttl` is optional seconds (0/omitted = host default).
     *  Throws on host error. Requires `auth.gate`. */
    grantSession(opts: GrantSessionRequest | string): void;
    /** Clear the current viewer's gate session (logout). The plugin still owns
     *  the response/redirect. Requires `auth.gate`. */
    endSession(): void;
  };
  /** Upload bytes to Owncast's storage backend (local or S3). Returns a
   *  public URL. Requires `storage.upload`. */
  storage: {
    upload(name: string, data: Uint8Array | string): UploadResult | null;
  };
  /** Private, sandboxed filesystem under data/plugin-storage/<slug>/files/. The bytes
   *  stay server-side (never served over HTTP) and the host confines every
   *  path to this plugin's own directory. All methods require `storage.fs`. */
  fs: {
    /** Read a file's raw bytes, or null if it doesn't exist. */
    read(path: string): Uint8Array | null;
    /** Read a file as UTF-8 text, or null if it doesn't exist. */
    readText(path: string): string | null;
    /** Write bytes or a string, creating parent directories as needed. */
    write(path: string, data: Uint8Array | string): FsResult;
    /** List entry names directly inside dir. A missing dir lists as empty. */
    list(dir: string): string[];
    /** Remove a single file or empty directory. */
    delete(path: string): FsResult;
    /** Report whether a path exists inside the sandbox. */
    exists(path: string): boolean;
  };
  /** Private SQLite database, one per plugin, stored in `db/` next to the
   *  `storage.fs` sandbox in `files/`, outside anything `owncast.fs.*` can name,
   *  and quota'd separately. Every call runs with a 2 second timeout. Absence
   *  of `error` means success. An error, missing response, or non-object
   *  response throws. JavaScript loses unsafe integers before `JSON.stringify`
   *  on writes and during `JSON.parse` on reads, so store values above
   *  `Number.MAX_SAFE_INTEGER` (2^53 - 1) as TEXT when they must remain exact.
   *  Requires `storage.sql`. */
  sql: {
    /** Execute one statement batch as a single transaction: it commits whole
     *  or leaves the database untouched. A transaction cannot stay open
     *  across calls. */
    exec(sql: string, params?: SQLValue[]): SQLExecResult;
    /** Query rows as objects keyed by column name. Alias duplicate columns.
     *  The result is never silently shortened: a query returning more than
     *  10000 rows, or more than 1 MiB of encoded data, throws asking for a
     *  LIMIT. */
    query(sql: string, params?: SQLValue[]): SQLRow[];
    /** Return the first matching row, or null. Only that row is read back, so
     *  this stays under the result budget on a table `query` is too big
     *  for. */
    queryRow(sql: string, params?: SQLValue[]): SQLRow | null;
  };
  /** Post to the fediverse on the streamer's behalf. Requires `fediverse.post`,
   *  which is high-trust (posts go out under the streamer's own handle), so
   *  admins should grant it sparingly. */
  fediverse: {
    /** Publish a public, text-only post. Returns `{ url }` (currently empty
     *  on success: Owncast publishes the note but doesn't yet round-trip its
     *  URL), or `null` when the host rejects the call (disabled, missing
     *  permission, etc.). */
    post(text: string): { url: string } | null;
  };
  /** Send notifications via Owncast's configured channels.
   *  Requires `notifications.send`. */
  notifications: {
    /** Post via the Owncast-configured Discord webhook. */
    discord(text: string): void;
    /** Send a browser push notification to subscribed clients. */
    browserPush(payload: string | BrowserPushPayload): void;
    /** Broadcast a fediverse engagement event. */
    fediverse(payload: FediversePayload): void;
  };
  kv: {
    get(key: string): string | null;
    set(key: string, value: string | number): void;
    /** Read a JSON value, parsed. Returns `fallback` (default `undefined`)
     *  when the key is unset or holds invalid JSON. Requires `storage.kv`. */
    getJSON<T = unknown>(key: string, fallback?: T): T;
    /** Store a value as JSON. Requires `storage.kv`. */
    setJSON(key: string, value: unknown): void;
  };
  /** Read this plugin's admin-configurable settings, declared under
   *  `config` in the manifest. Ambient, so no permission is required. */
  config: {
    /** The effective value of a manifest-declared config key (admin override,
     *  else the declared default), parsed to its declared type. Returns
     *  `fallback` (default `undefined`) for an unknown key or one with no
     *  value. */
    get<T = unknown>(key: string, fallback?: T): T;
  };
  /** Read files the plugin bundled in its own `assets/` directory: templates,
   *  data files, and other bundled resources loaded at request time. Path is
   *  relative to `assets/` and must not contain `..`. Ambient, so no permission
   *  is required. */
  assets: {
    /** Raw bytes of the file, or `null` if not found. */
    read(path: string): Uint8Array | null;
    /** File contents as a UTF-8 string, or `null` if not found. */
    readText(path: string): string | null;
  };
  events: {
    emit(eventType: string, payload: unknown): void;
  };
  /** Control over the viewer action buttons this plugin contributes.
   *  The effective list shown to viewers is `manifest.actions` ++
   *  whatever has been added at runtime via `add`. Requires
   *  `ui.modify`. */
  actions: {
    /** Append one or more buttons to the plugin's runtime list. Each
     *  entry is validated with the same rules as `manifest.actions`
     *  (title required, exactly one of `url` or `html`, relative URLs
     *  rewritten into this plugin's namespace, cross-plugin URLs
     *  rejected). The next viewer `/api/config` request returns
     *  `manifest.actions` ++ the runtime list. */
    add(actions: ActionButton | ActionButton[]): void;
    /** Drop the runtime additions, so only `manifest.actions` remain on
     *  the next viewer `/api/config` request. */
    clear(): void;
  };
  sse: {
    /** Push one Server-Sent-Event to every browser connected to this
     *  plugin's `/plugins/<name>/_sse/<channel>` stream. `event` is the SSE
     *  event name (`""` → the default "message" event). `data` is sent as-is
     *  if a string, otherwise JSON-stringified. Fire-and-forget, and frames to a
     *  slow client are dropped rather than blocking the plugin. Requires the
     *  `http.sse` permission. */
    send(channel: string, event: string, data: unknown): void;
  };
  /** Host-driven timers. The sandbox has no setTimeout, so these ask the host to
   *  call your callback back later (in this instance). No permission required.
   *  Timers do not survive a plugin reload or host restart. */
  timer: {
    /** Run `fn` once after ~`ms` milliseconds. Returns an id for `clear()`.
     *  Very small delays are clamped up by the host. Throws past the
     *  per-plugin pending-timer cap. */
    setTimeout(fn: () => void, ms: number): number;
    /** Run `fn` every ~`ms` milliseconds until `clear()`. The next run is
     *  scheduled only after the previous one returns. Returns an id. */
    setInterval(fn: () => void, ms: number): number;
    /** Cancel a pending timeout or interval by its id. */
    clear(id: number): void;
  };
  http: {
    fetch(url: string, opts?: HttpRequestOpts): HttpResponse;
  };
  /** Read live stream state + read-only broadcast telemetry. Requires `server.read`. */
  stream: {
    current(): StreamInfo;
    broadcaster(): StreamBroadcaster;
  };
  /** Read server config. Requires `server.read` permission. */
  server: {
    info(): ServerInfo;
    socials(): SocialHandle[];
    /** Custom chat emotes (`:code:` → image URL) configured on this server. */
    emotes(): Emote[];
    federation(): FederationInfo;
    tags(): string[];
  };
  /** Read/change video/transcoding configuration. read() requires
   *  `videoconfig.read`. write() requires `videoconfig.write` and throws when
   *  the host rejects the update or does not return an operation result. */
  videoConfig: {
    read(): VideoConfig;
    write(config: VideoConfigUpdate): void;
  };
};

export interface HttpRequestOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** An entry in `manifest.actions`, declares an action button the Owncast
 *  UI surfaces while this plugin is enabled. Mirrors Owncast's existing
 *  ExternalAction shape. The host merges enabled-plugin buttons with the
 *  admin-configured list.
 *
 *  Exactly one of `url` or `html` is required.
 *
 *  URL ergonomics: if `url` starts with `/` but not `/plugins/`, the host
 *  rewrites it to `/plugins/<your-plugin-name>/<path>` at load time, so
 *  `"url": "/"` becomes `"/plugins/my-plugin/"`. Absolute http(s) URLs and
 *  explicit `/plugins/<your-name>/...` paths are accepted unchanged.
 *
 *  When the resolved URL points back into this plugin, the manifest must
 *  declare `http.serve`, the host rejects the load otherwise. */
export interface ActionButton {
  /** Button label. Required. */
  title: string;
  /** Load this URL when the button is pressed. Mutually exclusive with `html`. */
  url?: string;
  /** Render this raw HTML when the button is pressed. Mutually exclusive with `url`. */
  html?: string;
  /** Icon image URL, same path conventions as `url`. */
  icon?: string;
  /** Accent color, e.g. "#3b82f6". */
  color?: string;
  /** Tooltip / longer description. */
  description?: string;
  /** When true, open in a new tab instead of an in-page modal. */
  openExternally?: boolean;
}

/** `manifest.network`, narrows outbound HTTP scope for plugins that
 *  declare the `network.fetch` permission. Required when that permission
 *  is granted. The host rejects loads otherwise. */
export interface NetworkConfig {
  /** Hostname globs the plugin can reach via `owncast.http.fetch`.
   *  Bare names match exactly (`"api.discord.com"`), and `*` is a wildcard
   *  segment (`"*.weather.com"`). The bare wildcard `"*"` matches any
   *  host but must be written explicitly. */
  allowedHosts: string[];
}

/** `manifest.category` (optional), the plugin's registry browse category.
 *  One of the canonical slugs below. The plugin registry uses it to filter
 *  the browse listing; unknown values are tolerated but won't match any
 *  filter.
 *
 *  - `chat-bots`: Chat bots
 *  - `chat-filters`: Chat filters
 *  - `moderation`: Moderation
 *  - `authentication`: Authentication
 *  - `themes`: Themes
 *  - `overlays`: Overlays & widgets
 *  - `notifications`: Notifications
 *  - `integrations`: Integrations
 *  - `video`: Video & streaming
 *  - `analytics`: Analytics & stats
 *  - `games`: Games & fun
 *  - `admin-utilities`: Admin utilities
 *  - `examples`: Examples
 *  - `other`: Other */
export type PluginCategory =
  | "chat-bots"
  | "chat-filters"
  | "moderation"
  | "authentication"
  | "themes"
  | "overlays"
  | "notifications"
  | "integrations"
  | "video"
  | "analytics"
  | "games"
  | "admin-utilities"
  | "examples"
  | "other";
