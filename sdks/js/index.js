// @owncast/plugin-sdk runtime, bundled into every plugin.
//
// Authors define typed handlers (onChatMessage, filterChatMessage, ...) plus
// an `on: { [customEvent]: handler }` object for plugin-emitted events. The
// SDK derives the manifest's subscriptions from which handlers are present
// and returns them via register(); authors don't maintain a duplicate list.

let registered = null;

const FilterAction = Object.freeze({
  Pass: "pass",
  Modify: "modify",
  Drop: "drop"
});

const Events = Object.freeze({
  // Chat events
  ChatMessageReceived:  "chat.message.received",
  ChatUserJoined:       "chat.user.joined",
  ChatUserParted:       "chat.user.parted",
  ChatUserRenamed:      "chat.user.renamed",
  ChatMessageModerated: "chat.message.moderated",
  // Stream lifecycle
  StreamStarted:        "stream.started",
  StreamStopped:        "stream.stopped",
  StreamTitleChanged:   "stream.title.changed",
  // Fediverse — engagement (metadata only) + inbound posts (with content)
  FediverseFollow:      "fediverse.follow",
  FediverseLike:        "fediverse.like",
  FediverseRepost:      "fediverse.repost",
  FediverseMention:     "fediverse.mention",
  FediverseReply:       "fediverse.reply"
});

const Permissions = Object.freeze({
  ChatSend:          "chat.send",
  ChatHistory:       "chat.history",
  ChatModerate:      "chat.moderate",
  StorageKV:         "storage.kv",
  StorageUpload:     "storage.upload",
  EventsEmit:        "events.emit",
  NetworkFetch:      "network.fetch",
  HttpServe:         "http.serve",
  ServerRead:        "server.read",
  NotificationsSend: "notifications.send",
  UsersRead:         "users.read",
  UsersModerate:     "users.moderate",
  FediversePost:     "fediverse.post",
  HttpSSE:           "http.sse",
  VideoConfigRead:   "videoconfig.read",
  VideoConfigWrite:  "videoconfig.write"
});

const filter = Object.freeze({
  pass() {
    return { action: FilterAction.Pass };
  },
  modify(payload) {
    return { action: FilterAction.Modify, payload };
  },
  drop(reason) {
    return { action: FilterAction.Drop, reason: reason || "" };
  }
});

// Distinguishes notification handlers from filter handlers in the HANDLERS
// map below. Internal — not part of the public API.
const HandlerKind = Object.freeze({
  Notify: "notify",
  Filter: "filter"
});

// Maps a built-in handler method name to the event type it subscribes to and
// whether it's a notification or a filter handler. Add entries here to expose
// new built-in Owncast events.
const HANDLERS = Object.freeze({
  // Chat
  onChatMessage:        { event: Events.ChatMessageReceived,  kind: HandlerKind.Notify },
  filterChatMessage:    { event: Events.ChatMessageReceived,  kind: HandlerKind.Filter },
  onChatUserJoined:     { event: Events.ChatUserJoined,       kind: HandlerKind.Notify },
  onChatUserParted:     { event: Events.ChatUserParted,       kind: HandlerKind.Notify },
  onChatUserRenamed:    { event: Events.ChatUserRenamed,      kind: HandlerKind.Notify },
  onMessageModerated:   { event: Events.ChatMessageModerated, kind: HandlerKind.Notify },
  // Stream lifecycle
  onStreamStarted:      { event: Events.StreamStarted,        kind: HandlerKind.Notify },
  onStreamStopped:      { event: Events.StreamStopped,        kind: HandlerKind.Notify },
  onStreamTitleChanged: { event: Events.StreamTitleChanged,   kind: HandlerKind.Notify },
  // Fediverse engagement (actor + target metadata)
  onFediverseFollow:    { event: Events.FediverseFollow,      kind: HandlerKind.Notify },
  onFediverseLike:      { event: Events.FediverseLike,        kind: HandlerKind.Notify },
  onFediverseRepost:    { event: Events.FediverseRepost,      kind: HandlerKind.Notify },
  // Fediverse inbound posts (with content)
  onFediverseMention:   { event: Events.FediverseMention,     kind: HandlerKind.Notify },
  onFediverseReply:     { event: Events.FediverseReply,       kind: HandlerKind.Notify }
});

// typeof comparisons in well-known categories. JS guarantees these strings,
// but we go through named constants so a stray typo can't pass silently.
const JsType = Object.freeze({
  Function: "function",
  Object: "object"
});
const isFn = (x) => typeof x === JsType.Function;
const isObj = (x) => x !== null && typeof x === JsType.Object;

function definePlugin(def) {
  registered = def;
  return def;
}

// Used by the build-generated entry to compute subscriptions for register().
// Filters can optionally declare a priority via definePlugin({filterPriority}),
// applied to every filter subscription this plugin owns. Lower = earlier.
function describeSubscriptions() {
  const notify = [];
  const filterSubs = [];
  if (registered) {
    const priority = typeof registered.filterPriority === "number" ? registered.filterPriority : 100;
    for (const [method, info] of Object.entries(HANDLERS)) {
      if (!isFn(registered[method])) continue;
      if (info.kind === HandlerKind.Notify) {
        notify.push({ event: info.event });
      } else {
        filterSubs.push({ event: info.event, priority });
      }
    }
    if (isObj(registered.on)) {
      for (const eventType of Object.keys(registered.on)) {
        notify.push({ event: eventType });
      }
    }
  }
  return { notify, filter: filterSubs };
}

function dispatchEvent(envelope) {
  if (!registered) return;
  const { eventType, payload } = envelope;
  for (const [method, info] of Object.entries(HANDLERS)) {
    if (info.kind === HandlerKind.Notify && info.event === eventType && isFn(registered[method])) {
      registered[method](payload);
      return;
    }
  }
  if (registered.on && isFn(registered.on[eventType])) {
    registered.on[eventType](payload);
  }
}

function dispatchFilter(envelope) {
  if (!registered) return filter.pass();
  const { eventType, payload } = envelope;
  for (const [method, info] of Object.entries(HANDLERS)) {
    if (info.kind === HandlerKind.Filter && info.event === eventType && isFn(registered[method])) {
      return registered[method](payload) || filter.pass();
    }
  }
  return filter.pass();
}

// dispatchHttp routes incoming HTTP requests to the user's onHttpRequest
// handler. Returns a default 404 if the plugin doesn't define one.
function dispatchHttp(request) {
  if (!registered || !isFn(registered.onHttpRequest)) {
    return { status: 404, headers: {}, body: "" };
  }
  const out = registered.onHttpRequest(request);
  if (!out) return { status: 200, headers: {}, body: "" };
  return {
    status: out.status || 200,
    headers: out.headers || {},
    body: out.body == null ? "" : String(out.body)
  };
}

const owncast = {
  chat: {
    send(text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_send_chat) throw new Error(`permission '${Permissions.ChatSend}' not granted`);
      fns.owncast_send_chat(Memory.fromString(text).offset);
    },
    sendAction(text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_send_chat_action) throw new Error(`permission '${Permissions.ChatSend}' not granted`);
      fns.owncast_send_chat_action(Memory.fromString(text).offset);
    },
    system(body) {
      const fns = Host.getFunctions();
      if (!fns.owncast_send_chat_system) throw new Error(`permission '${Permissions.ChatSend}' not granted`);
      fns.owncast_send_chat_system(Memory.fromString(body).offset);
    },
    history(limit) {
      const fns = Host.getFunctions();
      if (!fns.owncast_chat_history) throw new Error(`permission '${Permissions.ChatHistory}' not granted`);
      const offset = fns.owncast_chat_history(limit || 0);
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    deleteMessage(messageId) {
      const fns = Host.getFunctions();
      if (!fns.owncast_delete_message) throw new Error(`permission '${Permissions.ChatModerate}' not granted`);
      fns.owncast_delete_message(Memory.fromString(String(messageId)).offset);
    },
    kick(clientId) {
      const fns = Host.getFunctions();
      if (!fns.owncast_kick_client) throw new Error(`permission '${Permissions.ChatModerate}' not granted`);
      fns.owncast_kick_client(BigInt(clientId));
    },
    sendTo(clientId, text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_send_chat_to) throw new Error(`permission '${Permissions.ChatSend}' not granted`);
      fns.owncast_send_chat_to(BigInt(clientId), Memory.fromString(text).offset);
    },
    clients() {
      const fns = Host.getFunctions();
      if (!fns.owncast_chat_clients) throw new Error(`permission '${Permissions.ChatHistory}' not granted`);
      const offset = fns.owncast_chat_clients();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    }
  },
  users: {
    list() {
      const fns = Host.getFunctions();
      if (!fns.owncast_users_list) throw new Error(`permission '${Permissions.UsersRead}' not granted`);
      const offset = fns.owncast_users_list();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    get(id) {
      const fns = Host.getFunctions();
      if (!fns.owncast_user_get) throw new Error(`permission '${Permissions.UsersRead}' not granted`);
      const offset = fns.owncast_user_get(Memory.fromString(id).offset);
      if (offset == 0) return null;
      return JSON.parse(Memory.find(offset).readString());
    },
    setEnabled(id, enabled, reason) {
      const fns = Host.getFunctions();
      if (!fns.owncast_user_set_enabled) throw new Error(`permission '${Permissions.UsersModerate}' not granted`);
      fns.owncast_user_set_enabled(
        Memory.fromString(id).offset,
        enabled ? 1 : 0,
        Memory.fromString(reason || "").offset
      );
    },
    banIP(ip) {
      const fns = Host.getFunctions();
      if (!fns.owncast_ban_ip) throw new Error(`permission '${Permissions.UsersModerate}' not granted`);
      fns.owncast_ban_ip(Memory.fromString(ip).offset);
    }
  },
  storage: {
    upload(name, data) {
      const fns = Host.getFunctions();
      if (!fns.owncast_storage_upload) throw new Error(`permission '${Permissions.StorageUpload}' not granted`);
      const dataMem = data instanceof Uint8Array
        ? Memory.fromBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
        : Memory.fromString(String(data));
      const offset = fns.owncast_storage_upload(
        Memory.fromString(name).offset,
        dataMem.offset
      );
      if (offset == 0) return null;
      return JSON.parse(Memory.find(offset).readString());
    }
  },
  fediverse: {
    /** Publish a public text-only post to the fediverse on the streamer's
     *  behalf. Returns { url } on success, null on failure (rate-limited,
     *  disabled by admin, etc.). Requires `fediverse.post`. */
    post(text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_fediverse_post) throw new Error(`permission '${Permissions.FediversePost}' not granted`);
      const offset = fns.owncast_fediverse_post(Memory.fromString(text).offset);
      if (offset == 0) return null;
      return JSON.parse(Memory.find(offset).readString());
    }
  },
  notifications: {
    discord(text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_notify_discord) throw new Error(`permission '${Permissions.NotificationsSend}' not granted`);
      fns.owncast_notify_discord(Memory.fromString(text).offset);
    },
    browserPush(payload) {
      const fns = Host.getFunctions();
      if (!fns.owncast_notify_browser_push) throw new Error(`permission '${Permissions.NotificationsSend}' not granted`);
      const obj = typeof payload === "string" ? { title: payload } : payload;
      fns.owncast_notify_browser_push(Memory.fromString(JSON.stringify(obj)).offset);
    },
    fediverse(payload) {
      const fns = Host.getFunctions();
      if (!fns.owncast_notify_fediverse) throw new Error(`permission '${Permissions.NotificationsSend}' not granted`);
      fns.owncast_notify_fediverse(Memory.fromString(JSON.stringify(payload)).offset);
    }
  },
  stream: {
    current() {
      const fns = Host.getFunctions();
      if (!fns.owncast_stream_current) throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_stream_current();
      if (offset == 0) return { online: false, viewers: 0 };
      return JSON.parse(Memory.find(offset).readString());
    },
    broadcaster() {
      const fns = Host.getFunctions();
      if (!fns.owncast_stream_broadcaster) throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_stream_broadcaster();
      if (offset == 0) return {};
      return JSON.parse(Memory.find(offset).readString());
    }
  },
  server: {
    info() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_info) throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_info();
      if (offset == 0) return {};
      return JSON.parse(Memory.find(offset).readString());
    },
    socials() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_socials) throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_socials();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    federation() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_federation) throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_federation();
      if (offset == 0) return { enabled: false };
      return JSON.parse(Memory.find(offset).readString());
    },
    tags() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_tags) throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_tags();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    }
  },
  videoConfig: {
    /** Read the current video/transcoding config: { latencyLevel, codec,
     *  variants }. Requires `videoconfig.read`. */
    read() {
      const fns = Host.getFunctions();
      if (!fns.owncast_video_config_read) throw new Error(`permission '${Permissions.VideoConfigRead}' not granted`);
      const offset = fns.owncast_video_config_read();
      if (offset == 0) return { latencyLevel: 0, codec: "", variants: [] };
      return JSON.parse(Memory.find(offset).readString());
    },
    /** Apply a partial video config change. Pass any of { latencyLevel, codec,
     *  variants }; omitted fields are left unchanged. Throws if the host
     *  rejects the config. Requires `videoconfig.write`. */
    write(config) {
      const fns = Host.getFunctions();
      if (!fns.owncast_video_config_write) throw new Error(`permission '${Permissions.VideoConfigWrite}' not granted`);
      const offset = fns.owncast_video_config_write(Memory.fromString(JSON.stringify(config || {})).offset);
      if (offset == 0) throw new Error('videoConfig.write failed');
      const result = JSON.parse(Memory.find(offset).readString());
      if (!result.ok) throw new Error(result.error || 'videoConfig.write failed');
    }
  },
  kv: {
    get(key) {
      const fns = Host.getFunctions();
      if (!fns.owncast_kv_get) throw new Error(`permission '${Permissions.StorageKV}' not granted`);
      const offset = fns.owncast_kv_get(Memory.fromString(key).offset);
      if (offset == 0) return null;
      return Memory.find(offset).readString();
    },
    set(key, value) {
      const fns = Host.getFunctions();
      if (!fns.owncast_kv_set) throw new Error(`permission '${Permissions.StorageKV}' not granted`);
      fns.owncast_kv_set(
        Memory.fromString(key).offset,
        Memory.fromString(String(value)).offset
      );
    }
  },
  events: {
    emit(eventType, payload) {
      const fns = Host.getFunctions();
      if (!fns.owncast_emit_event) throw new Error(`permission '${Permissions.EventsEmit}' not granted`);
      fns.owncast_emit_event(
        Memory.fromString(eventType).offset,
        Memory.fromString(JSON.stringify(payload)).offset
      );
    }
  },
  sse: {
    // send(channel, event, data) pushes one Server-Sent-Event to every
    // browser connected to this plugin's /plugins/<name>/_sse/<channel>
    // stream. `event` is the SSE event name (browser side:
    // source.addEventListener(event, ...)); pass "" for the default
    // "message" event. `data` is sent as-is if it's a string, otherwise
    // JSON-stringified. Fire-and-forget: returns immediately, and frames to
    // a slow client are dropped rather than blocking the plugin. Requires
    // the 'http.sse' permission.
    send(channel, event, data) {
      const fns = Host.getFunctions();
      if (!fns.owncast_sse_send) throw new Error(`permission '${Permissions.HttpSSE}' not granted`);
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      fns.owncast_sse_send(
        Memory.fromString(channel || "").offset,
        Memory.fromString(event || "").offset,
        Memory.fromString(payload).offset
      );
    }
  },
  http: {
    // fetch(url, opts) → { status, headers, body }
    // Wraps Extism's built-in Http.request. Throws if the manifest didn't
    // declare 'network.fetch' (the host won't have set AllowedHosts, so the
    // underlying call fails).
    fetch(url, opts) {
      opts = opts || {};
      const req = {
        url,
        method: opts.method || "GET",
        headers: opts.headers || {}
      };
      const body = opts.body != null ? String(opts.body) : null;
      const res = body != null ? Http.request(req, body) : Http.request(req);
      return { status: res.status, headers: res.headers || {}, body: res.body || "" };
    }
  }
};

module.exports = {
  definePlugin,
  owncast,
  filter,
  FilterAction,
  Events,
  Permissions,
  describeSubscriptions,
  dispatchEvent,
  dispatchFilter,
  dispatchHttp
};
