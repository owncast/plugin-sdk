/**
 * Built-in chat message payload (`chat.message.received` and the chat filter).
 *
 * `user` carries the full sender identity — use `user.id` for stable per-user
 * state and `user.scopes` (e.g. `"MODERATOR"`) for reliable, non-spoofable
 * moderation gating rather than matching on the display name. `clientId`
 * identifies the originating connection; pass it to `owncast.chat.sendTo` (or
 * `owncast.chat.replyTo(msg, …)`) to whisper a reply back to the sender.
 *
 * `user` is undefined for the rare message with no associated account.
 */
export interface ChatMessage {
  id: string;
  user?: ChatUser;
  clientId?: number;
  body: string;
  timestamp: string;
}

/** A chat user, payload of join/part/rename events. */
export interface ChatUser {
  id: string;
  displayName: string;
  isBot?: boolean;
  isAuthenticated?: boolean;
  scopes?: string[];
}

/** Payload of `chat.user.renamed`, the same user changing their name. */
export interface ChatUserRename {
  user: ChatUser;
  previousName: string;
}

/** Payload of `chat.message.moderated`, a message hidden/restored by a mod. */
export interface ChatMessageModeration {
  messageId: string;
  visible: boolean;
  moderator?: ChatUser;
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
  readonly FediverseFollow: "fediverse.follow";
  readonly FediverseLike: "fediverse.like";
  readonly FediverseRepost: "fediverse.repost";
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
  /** For likes and reposts: the target object URL. Not set for follows. */
  target?: { url: string };
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
  readonly EventsEmit: "events.emit";
  readonly NetworkFetch: "network.fetch";
  readonly HttpServe: "http.serve";
  readonly ServerRead: "server.read";
  readonly NotificationsSend: "notifications.send";
  readonly UsersRead: "users.read";
  readonly UsersModerate: "users.moderate";
  readonly FediversePost: "fediverse.post";
  readonly HttpSSE: "http.sse";
  readonly VideoConfigRead: "videoconfig.read";
  readonly VideoConfigWrite: "videoconfig.write";
  readonly UIModify: "ui.modify";
};

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

/** A user record from owncast.users.list() / .get(). */
export interface User {
  id: string;
  displayName: string;
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

/** Result of a mutating owncast.fs call (write/delete). `ok` is false and
 *  `error` is set when the host rejected the operation. */
export interface FsResult {
  ok: boolean;
  error?: string;
}

export const filter: {
  pass(): FilterResult;
  modify(payload: any): FilterResult;
  drop(reason?: string): FilterResult;
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
  user?: ChatUser;
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
  user?: ChatUser;
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
  user?: ChatUser;
}

/** Payload for the once-a-second tick event (onTick). `now` is the host
 *  wall-clock time in unix milliseconds when the tick fired. */
export interface TickEvent {
  now: number;
}

export interface PluginDef {
  /** Declarative chat-command table. When set, the SDK wires the chat
   *  subscription and prefix parsing for you — no onChatMessage needed. Maps
   *  canonical command name → definition (run/description/usage/aliases/
   *  modOnly/cooldownMs/...); see {@link CommandDefinition}. For advanced
   *  composition (e.g. dropping command messages via a filter) use the
   *  lower-level {@link defineCommands} router instead. If you also provide
   *  onChatMessage, the router runs first and then onChatMessage runs for every
   *  message. */
  commands?: Record<string, CommandDefinition>;
  /** Command prefix for the `commands` table. Default "!". */
  commandPrefix?: string;
  /** Match command names case-sensitively. Default false. */
  commandsCaseSensitive?: boolean;
  /** Called when a prefixed message matched no command in `commands`. */
  onUnknownCommand?(ctx: CommandContext): void;

  /** Notification handler for chat messages. Fire-and-forget. */
  onChatMessage?(msg: ChatMessage): void | Promise<void>;

  /** Filter handler for chat messages. Return filter.pass() / .modify() / .drop().
   *  Errors are treated as filter.pass() (fail-open). */
  filterChatMessage?(msg: ChatMessage): FilterResult;

  /** User connected to chat. */
  onChatUserJoined?(user: ChatUser): void | Promise<void>;
  /** User disconnected from chat. */
  onChatUserParted?(user: ChatUser): void | Promise<void>;
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

  /** Someone on the fediverse followed the streamer's account. */
  onFediverseFollow?(event: FediverseEngagement): void | Promise<void>;
  /** Someone on the fediverse liked a streamer post / federated stream announcement. */
  onFediverseLike?(event: FediverseEngagement): void | Promise<void>;
  /** Someone on the fediverse boosted (reposted) a streamer post. */
  onFediverseRepost?(event: FediverseEngagement): void | Promise<void>;
  /** Someone @-mentioned the streamer in a public post. */
  onFediverseMention?(post: FediverseInboundPost): void | Promise<void>;
  /** Someone replied to one of the streamer's federated posts. */
  onFediverseReply?(post: FediverseInboundPost): void | Promise<void>;

  /** HTTP request handler. Called for any path under /plugins/<name>/ that
   *  isn't served as a static asset. Default-public, gate admin features
   *  on `req.authenticated` yourself. Requires `http.serve` permission. */
  onHttpRequest?(req: IncomingHttpRequest): OutgoingHttpResponse;

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

  /** Return CSS to inline into the viewer page's customStyles at request
   *  time — the same core-theming slot used by `manifest.styles`, applied to
   *  the whole UI. Called once per `/api/config` for any plugin holding
   *  `ui.modify`; no manifest field is needed, just export this handler.
   *  Return "" to contribute nothing. The output is appended after any static
   *  `manifest.styles` files, so returning only the active override wins the
   *  cascade. Global (no per-viewer argument) so `/api/config` stays
   *  cacheable. Requires `ui.modify`. */
  onPageStyles?(): string;

  /** Return JavaScript to append to the viewer page's customJavascript at
   *  request time — the dynamic counterpart to `manifest.scripts`. Called once
   *  per `/api/config` for any plugin holding `ui.modify`. The host wraps each
   *  plugin's script (static and dynamic) in a try/catch so a runtime error
   *  can't break other plugins, but it runs in the shared viewer `window`:
   *  wrap your code in an IIFE to avoid global collisions, and escape any
   *  untrusted strings you embed. Return "" to contribute nothing. Requires
   *  `ui.modify`. */
  onPageScripts?(): string;

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
  user?: ChatUser;
  /** The canonical command name that matched (not the alias used). */
  command: string;
  /** Whitespace-split arguments after the command word. */
  args: string[];
  /** The raw argument string (everything after the command word, trimmed). */
  argString: string;
  /** Post a public reply as the plugin's chat bot. */
  reply(text: string): void;
  /** Whisper a reply to the sender; falls back to a public post if their
   *  connection is unknown. */
  replyPrivately(text: string): void;
}

/** One command in a {@link defineCommands} table. */
export interface CommandDefinition {
  /** Short, human-readable summary of what the command does. Surfaced in
   *  command listings (e.g. a future `!help`); ignored by the router itself. */
  description?: string;
  /** Optional usage/example string, e.g. "!latency <0-4>". */
  usage?: string;
  /** Alternate names that invoke this command. */
  aliases?: string[];
  /** Only allow senders whose scopes include "MODERATOR". */
  modOnly?: boolean;
  /** Minimum milliseconds between invocations per user (clocked off
   *  `msg.timestamp`). */
  cooldownMs?: number;
  /** Invoked when the command runs. */
  run(ctx: CommandContext): void;
  /** Invoked instead of `run` when a non-moderator calls a `modOnly` command. */
  onDenied?(ctx: CommandContext): void;
  /** Invoked instead of `run` when the per-user cooldown hasn't elapsed. */
  onCooldown?(ctx: CommandContext): void;
}

export interface CommandsConfig {
  /** Command prefix. Default `"!"`. */
  prefix?: string;
  /** Match command names case-sensitively. Default false. */
  caseSensitive?: boolean;
  commands: Record<string, CommandDefinition>;
  /** Fallback when a prefixed message matches no command. */
  onUnknown?(ctx: CommandContext): void;
  /** Default denied/cooldown handlers, used when a command omits its own. */
  onDenied?(ctx: CommandContext): void;
  onCooldown?(ctx: CommandContext): void;
}

/** Build a chat-command router (prefix parsing, aliases, per-user cooldowns,
 *  moderator gating). Feed the returned function a `ChatMessage`; it returns
 *  true when the message was a command (even if gated), false otherwise. */
export function defineCommands(
  config: CommandsConfig,
): (msg: ChatMessage) => boolean;

/** Typed wrappers around the Owncast host. Each method throws if the
 *  corresponding permission was not declared in plugin.manifest.json. */
export const owncast: {
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
     *  Default limit is 50; pass a smaller number to get fewer. */
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
    /** Enable/disable a user; reason is optional. Requires `users.moderate`. */
    setEnabled(id: string, enabled: boolean, reason?: string): void;
    /** Ban an IP address. Requires `users.moderate`. */
    banIP(ip: string): void;
  };
  /** Upload bytes to Owncast's storage backend (local or S3); returns a
   *  public URL. Requires `storage.upload`. */
  storage: {
    upload(name: string, data: Uint8Array | string): UploadResult | null;
  };
  /** Private, sandboxed filesystem under data/plugin-data/<slug>/. The bytes
   *  stay server-side (never served over HTTP) and the host confines every
   *  path to this plugin's own directory. All methods require `storage.fs`. */
  fs: {
    /** Read a file's raw bytes, or null if it doesn't exist. */
    read(path: string): Uint8Array | null;
    /** Read a file as UTF-8 text, or null if it doesn't exist. */
    readText(path: string): string | null;
    /** Write bytes or a string, creating parent directories as needed. */
    write(path: string, data: Uint8Array | string): FsResult;
    /** List entry names directly inside dir; missing dir lists as empty. */
    list(dir: string): string[];
    /** Remove a single file or empty directory. */
    delete(path: string): FsResult;
    /** Report whether a path exists inside the sandbox. */
    exists(path: string): boolean;
  };
  /** Post to the fediverse on the streamer's behalf. Requires `fediverse.post`,
   *  which is high-trust (posts go out under the streamer's own handle);
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
   *  `config` in the manifest. Ambient — no permission required. */
  config: {
    /** The effective value of a manifest-declared config key (admin override,
     *  else the declared default), parsed to its declared type. Returns
     *  `fallback` (default `undefined`) for an unknown key or one with no
     *  value. */
    get<T = unknown>(key: string, fallback?: T): T;
  };
  /** Read files the plugin bundled in its own `assets/` directory — templates,
   *  data files, and other bundled resources loaded at request time. Path is
   *  relative to `assets/` and must not contain `..`. Ambient — no permission
   *  required. */
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
     *  (title required; exactly one of `url` or `html`; relative URLs
     *  rewritten into this plugin's namespace; cross-plugin URLs
     *  rejected). The next viewer `/api/config` request returns
     *  `manifest.actions` ++ the runtime list. */
    add(actions: ActionButton | ActionButton[]): void;
    /** Drop the runtime additions; only `manifest.actions` remain on
     *  the next viewer `/api/config` request. */
    clear(): void;
  };
  sse: {
    /** Push one Server-Sent-Event to every browser connected to this
     *  plugin's `/plugins/<name>/_sse/<channel>` stream. `event` is the SSE
     *  event name (`""` → the default "message" event); `data` is sent as-is
     *  if a string, otherwise JSON-stringified. Fire-and-forget; frames to a
     *  slow client are dropped rather than blocking the plugin. Requires the
     *  `http.sse` permission. */
    send(channel: string, event: string, data: unknown): void;
  };
  /** Host-driven timers. The sandbox has no setTimeout; these ask the host to
   *  call your callback back later (in this instance). No permission required.
   *  Timers do not survive a plugin reload or host restart. */
  timer: {
    /** Run `fn` once after ~`ms` milliseconds. Returns an id for `clear()`.
     *  Very small delays are clamped up by the host; throws past the
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
   *  `videoconfig.read`; write() requires `videoconfig.write`. */
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
 *  ExternalAction shape; the host merges enabled-plugin buttons with the
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
 *  is granted; the host rejects loads otherwise. */
export interface NetworkConfig {
  /** Hostname globs the plugin can reach via `owncast.http.fetch`.
   *  Bare names match exactly (`"api.discord.com"`); `*` is a wildcard
   *  segment (`"*.weather.com"`). The bare wildcard `"*"` matches any
   *  host but must be written explicitly. */
  allowedHosts: string[];
}
