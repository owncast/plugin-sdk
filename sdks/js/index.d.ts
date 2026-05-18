/** Built-in chat message payload. */
export interface ChatMessage {
  id: string;
  user: string;
  body: string;
  timestamp: string;
}

/** A chat user — payload of join/part/rename events. */
export interface ChatUser {
  id: string;
  displayName: string;
  isBot?: boolean;
  isAuthenticated?: boolean;
  scopes?: string[];
}

/** Payload of `chat.user.renamed` — the same user changing their name. */
export interface ChatUserRename {
  user: ChatUser;
  previousName: string;
}

/** Payload of `chat.message.moderated` — a message hidden/restored by a mod. */
export interface ChatMessageModeration {
  messageId: string;
  visible: boolean;
  moderator?: ChatUser;
}

/** Stream-lifecycle payloads. */
export interface StreamLifecycleEvent {
  startedAt?: string;     // ISO-8601, set for stream.started
  stoppedAt?: string;     // ISO-8601, set for stream.stopped
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
  readonly FediverseFollow: "fediverse.follow";
  readonly FediverseLike: "fediverse.like";
  readonly FediverseRepost: "fediverse.repost";
  readonly FediverseMention: "fediverse.mention";
  readonly FediverseReply: "fediverse.reply";
};

/** Payload shape for fediverse engagement events. */
export interface FediverseActor {
  name: string;
  handle: string;      // e.g. "@alice@fediverse.example"
  url?: string;
  image?: string;
}

export interface FediverseEngagement {
  actor: FediverseActor;
  /** For likes and reposts: the target object URL. Not set for follows. */
  target?: { url: string };
}

/** Inbound fediverse post — a mention or reply that contains content the
 *  plugin can act on. Carries both the rendered content (which has the
 *  source instance's HTML) and a plain-text version (HTML stripped). */
export interface FediverseInboundPost {
  actor: FediverseActor;
  content: string;                 // HTML from the source instance
  contentText: string;             // HTML stripped to plain text
  url: string;                     // permalink to the post on its source
  postedAt: string;                // ISO-8601
  inReplyTo?: string;              // parent post URL, when this is a reply
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
  readonly StorageKV: "storage.kv";
  readonly StorageUpload: "storage.upload";
  readonly EventsEmit: "events.emit";
  readonly NetworkFetch: "network.fetch";
  readonly HttpServe: "http.serve";
  readonly ServerRead: "server.read";
  readonly NotificationsSend: "notifications.send";
  readonly UsersRead: "users.read";
  readonly UsersModerate: "users.moderate";
  readonly FediversePost: "fediverse.post";
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
  disabledAt?: string;        // ISO-8601 if banned, omitted otherwise
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

export interface PluginDef {
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
   *  isn't served as a static asset. Default-public — gate admin features
   *  on `req.authenticated` yourself. Requires `http.serve` permission. */
  onHttpRequest?(req: IncomingHttpRequest): OutgoingHttpResponse;

  /** Handlers for plugin-emitted custom events. The key is the event type
   *  string (e.g. "announcement.broadcast"). Notifications only — to filter
   *  custom events, additional API will be needed. */
  on?: { [eventType: string]: (payload: any) => void | Promise<void> };

  /** Filter chain priority (lower = earlier). Applies to every filter*
   *  handler this plugin defines. Default 100. */
  filterPriority?: number;
}

export function definePlugin(def: PluginDef): PluginDef;

/** Typed wrappers around the Owncast host. Each method throws if the
 *  corresponding permission was not declared in plugin.manifest.json. */
export const owncast: {
  chat: {
    /** Post as the plugin's own chat bot (display name = the plugin's name). */
    send(text: string): void;
    /** Same identity, but in action style (italic, like IRC "/me"). */
    sendAction(text: string): void;
    /** Post a system message — no user identity, rendered as a server
     *  announcement. The body is rendered as HTML, so the plugin is
     *  responsible for escaping any untrusted content. Same `chat.send`
     *  permission as the other send variants. */
    system(body: string): void;
    /** Private message to one chat client. */
    sendTo(clientId: number | bigint, text: string): void;
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
  /** Post to the fediverse on the streamer's behalf. Requires `fediverse.post`,
   *  which is high-trust — admins should grant it sparingly. The host
   *  rate-limits at ~5 posts/hour per plugin. */
  fediverse: {
    /** Publish a public, text-only post. Returns { url } on success or null
     *  on rate-limit / disabled / other failure. */
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
  };
  events: {
    emit(eventType: string, payload: unknown): void;
  };
  http: {
    fetch(url: string, opts?: HttpRequestOpts): HttpResponse;
  };
  /** Read live stream state. Requires `server.read` permission. */
  stream: {
    current(): StreamInfo;
  };
  /** Read server config. Requires `server.read` permission. */
  server: {
    info(): ServerInfo;
    socials(): SocialHandle[];
    federation(): FederationInfo;
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

/** An entry in `manifest.actions` — declares an action button the Owncast
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
 *  declare `http.serve` — the host rejects the load otherwise. */
export interface ActionButton {
  /** Button label. Required. */
  title: string;
  /** Load this URL when the button is pressed. Mutually exclusive with `html`. */
  url?: string;
  /** Render this raw HTML when the button is pressed. Mutually exclusive with `url`. */
  html?: string;
  /** Icon image URL — same path conventions as `url`. */
  icon?: string;
  /** Accent color, e.g. "#3b82f6". */
  color?: string;
  /** Tooltip / longer description. */
  description?: string;
  /** When true, open in a new tab instead of an in-page modal. */
  openExternally?: boolean;
}

/** `manifest.network` — narrows outbound HTTP scope for plugins that
 *  declare the `network.fetch` permission. Required when that permission
 *  is granted; the host rejects loads otherwise. */
export interface NetworkConfig {
  /** Hostname globs the plugin can reach via `owncast.http.fetch`.
   *  Bare names match exactly (`"api.discord.com"`); `*` is a wildcard
   *  segment (`"*.weather.com"`). The bare wildcard `"*"` matches any
   *  host but must be written explicitly. */
  allowedHosts: string[];
}
