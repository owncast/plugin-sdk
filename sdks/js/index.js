// @owncast/plugin-sdk runtime, bundled into every plugin.
//
// Authors define typed handlers (onChatMessage, filterChatMessage, ...) plus
// an `on: { [customEvent]: handler }` object for plugin-emitted events. The
// SDK derives the manifest's subscriptions from which handlers are present
// and returns them via register(); authors don't maintain a duplicate list.

let registered = null;

// Host-driven timers. The sandbox has no setTimeout, so owncast.timer.* asks
// the host to schedule a callback and call back via the internal "timer.fire"
// event. The author's callback stays here in the long-lived instance, keyed by
// a guest-allocated id the host echoes back. State persists across calls
// because the plugin instance is reused; timers are dropped on reload.
let nextTimerId = 1;
const timerCallbacks = new Map(); // id -> { fn, repeat }

const FilterAction = Object.freeze({
  Pass: "pass",
  Modify: "modify",
  Drop: "drop",
});

const Events = Object.freeze({
  // Chat events
  ChatMessageReceived: "chat.message.received",
  ChatUserJoined: "chat.user.joined",
  ChatUserParted: "chat.user.parted",
  ChatUserRenamed: "chat.user.renamed",
  ChatMessageModerated: "chat.message.moderated",
  // Stream lifecycle
  StreamStarted: "stream.started",
  StreamStopped: "stream.stopped",
  StreamTitleChanged: "stream.title.changed",
  // SSE connection lifecycle (who connected to / left a plugin's stream)
  SseConnect: "sse.connect",
  SseDisconnect: "sse.disconnect",
  // Once-a-second tick for periodic work (opt in by defining onTick)
  Tick: "tick",
  // Fediverse, engagement (metadata only) + inbound posts (with content)
  FediverseFollow: "fediverse.follow",
  FediverseLike: "fediverse.like",
  FediverseRepost: "fediverse.repost",
  FediverseMention: "fediverse.mention",
  FediverseReply: "fediverse.reply",
});

const Permissions = Object.freeze({
  ChatSend: "chat.send",
  ChatHistory: "chat.history",
  ChatModerate: "chat.moderate",
  ChatFilter: "chat.filter",
  StorageKV: "storage.kv",
  StorageUpload: "storage.upload",
  StorageFS: "storage.fs",
  EventsEmit: "events.emit",
  NetworkFetch: "network.fetch",
  HttpServe: "http.serve",
  ServerRead: "server.read",
  NotificationsSend: "notifications.send",
  UsersRead: "users.read",
  UsersModerate: "users.moderate",
  FediversePost: "fediverse.post",
  HttpSSE: "http.sse",
  VideoConfigRead: "videoconfig.read",
  VideoConfigWrite: "videoconfig.write",
  UIModify: "ui.modify",
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
  },
});

// Distinguishes notification handlers from filter handlers in the HANDLERS
// map below. Internal, not part of the public API.
const HandlerKind = Object.freeze({
  Notify: "notify",
  Filter: "filter",
});

// Maps a built-in handler method name to the event type it subscribes to and
// whether it's a notification or a filter handler. Add entries here to expose
// new built-in Owncast events.
const HANDLERS = Object.freeze({
  // Chat
  onChatMessage: {
    event: Events.ChatMessageReceived,
    kind: HandlerKind.Notify,
  },
  filterChatMessage: {
    event: Events.ChatMessageReceived,
    kind: HandlerKind.Filter,
  },
  onChatUserJoined: { event: Events.ChatUserJoined, kind: HandlerKind.Notify },
  onChatUserParted: { event: Events.ChatUserParted, kind: HandlerKind.Notify },
  onChatUserRenamed: {
    event: Events.ChatUserRenamed,
    kind: HandlerKind.Notify,
  },
  onMessageModerated: {
    event: Events.ChatMessageModerated,
    kind: HandlerKind.Notify,
  },
  // Stream lifecycle
  onStreamStarted: { event: Events.StreamStarted, kind: HandlerKind.Notify },
  onStreamStopped: { event: Events.StreamStopped, kind: HandlerKind.Notify },
  onStreamTitleChanged: {
    event: Events.StreamTitleChanged,
    kind: HandlerKind.Notify,
  },
  // SSE connection lifecycle
  onSseConnect: { event: Events.SseConnect, kind: HandlerKind.Notify },
  onSseDisconnect: { event: Events.SseDisconnect, kind: HandlerKind.Notify },
  // Once-a-second tick
  onTick: { event: Events.Tick, kind: HandlerKind.Notify },
  // Fediverse engagement (actor + target metadata)
  onFediverseFollow: {
    event: Events.FediverseFollow,
    kind: HandlerKind.Notify,
  },
  onFediverseLike: { event: Events.FediverseLike, kind: HandlerKind.Notify },
  onFediverseRepost: {
    event: Events.FediverseRepost,
    kind: HandlerKind.Notify,
  },
  // Fediverse inbound posts (with content)
  onFediverseMention: {
    event: Events.FediverseMention,
    kind: HandlerKind.Notify,
  },
  onFediverseReply: { event: Events.FediverseReply, kind: HandlerKind.Notify },
});

// typeof comparisons in well-known categories. JS guarantees these strings,
// but we go through named constants so a stray typo can't pass silently.
const JsType = Object.freeze({
  Function: "function",
  Object: "object",
});
const isFn = (x) => typeof x === JsType.Function;
const isObj = (x) => x !== null && typeof x === JsType.Object;

function definePlugin(def) {
  registered = def;
  return def;
}

// defineCommands builds a chat-command router so plugins stop reimplementing
// prefix parsing, aliases, per-user cooldowns, and moderator gating. It returns
// a function you feed a ChatMessage (from onChatMessage or filterChatMessage);
// it parses the command and invokes the matching handler's run(ctx). The return
// value is true when the message was a command (even if gated), false when it
// wasn't — so a filter can drop command messages from chat:
//
//   const commands = defineCommands({
//     prefix: "!",
//     commands: {
//       uptime: { run: (ctx) => ctx.reply("up!") },
//       ban: { modOnly: true, cooldownMs: 5000, run: (ctx) => ctx.reply(`bye ${ctx.args[0]}`) },
//     },
//   });
//   module.exports = definePlugin({
//     onChatMessage: commands,
//     // or, to hide command messages from chat:
//     // filterChatMessage: (msg) => (commands(msg) ? filter.drop("command") : filter.pass()),
//   });
//
// run(ctx) receives { msg, user, command, args, argString, reply, replyPrivately }.
// reply posts publicly; replyPrivately whispers to the sender (falling back to a
// public post if their connection is unknown). Optional hooks: per-command or
// top-level onCooldown(ctx) / onDenied(ctx), and a top-level onUnknown(ctx).
function defineCommands(config) {
  config = config || {};
  const prefix = config.prefix || "!";
  const caseSensitive = !!config.caseSensitive;
  const norm = (s) => (caseSensitive ? s : s.toLowerCase());

  // Resolve every name and alias to its canonical command definition.
  const table = new Map();
  const defs = config.commands || {};
  for (const name of Object.keys(defs)) {
    const def = defs[name];
    table.set(norm(name), { name, def });
    for (const alias of def.aliases || []) table.set(norm(alias), { name, def });
  }

  // Per-(command,user) cooldown clock, in memory for the plugin's lifetime.
  const lastRun = new Map();

  return function handle(msg) {
    const body = (msg && msg.body) || "";
    if (!body.startsWith(prefix)) return false;
    const rest = body.slice(prefix.length);
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return false;
    const called = parts[0];
    const args = parts.slice(1);
    const argString = rest.slice(called.length).trim();

    const ctx = {
      msg,
      user: msg && msg.user,
      command: norm(called),
      args,
      argString,
      reply: (text) => owncast.chat.send(text),
      replyPrivately: (text) => {
        if (!owncast.chat.replyTo(msg, text)) owncast.chat.send(text);
      },
    };

    const entry = table.get(norm(called));
    if (!entry) {
      if (isFn(config.onUnknown)) config.onUnknown(ctx);
      return false;
    }
    const { name, def } = entry;
    ctx.command = name;

    // Moderator gating: the sender's scopes must include MODERATOR.
    if (def.modOnly) {
      const scopes = (msg.user && msg.user.scopes) || [];
      if (!scopes.includes("MODERATOR")) {
        if (isFn(def.onDenied)) def.onDenied(ctx);
        else if (isFn(config.onDenied)) config.onDenied(ctx);
        return true; // matched a command, but the caller wasn't allowed
      }
    }

    // Per-user cooldown, clocked off msg.timestamp so it's deterministic in
    // tests and independent of any sandbox clock quirks.
    const cooldownMs = def.cooldownMs || 0;
    if (cooldownMs > 0) {
      const userId =
        (msg.user && msg.user.id) ||
        (msg.clientId != null ? `c${msg.clientId}` : "anon");
      const key = `${name} ${userId}`;
      const now = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      const prev = lastRun.get(key);
      if (now && prev && now - prev < cooldownMs) {
        if (isFn(def.onCooldown)) def.onCooldown(ctx);
        else if (isFn(config.onCooldown)) config.onCooldown(ctx);
        return true;
      }
      if (now) lastRun.set(key, now);
    }

    if (isFn(def.run)) def.run(ctx);
    return true;
  };
}

// Used by the build-generated entry to compute subscriptions for register().
// Filters can optionally declare a priority via definePlugin({filterPriority}),
// applied to every filter subscription this plugin owns. Lower = earlier.
function describeSubscriptions() {
  const notify = [];
  const filterSubs = [];
  if (registered) {
    const priority =
      typeof registered.filterPriority === "number"
        ? registered.filterPriority
        : 100;
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
  const { eventType, payload } = envelope;
  // Internal: a host-scheduled timer elapsed. Run the author's callback,
  // dropping one-shot entries first so a throw still cleans up. Not routed to
  // user handlers or the `on` map.
  if (eventType === "timer.fire") {
    const id = payload && payload.id;
    const entry = timerCallbacks.get(id);
    if (entry) {
      if (!entry.repeat) timerCallbacks.delete(id);
      entry.fn();
    }
    return;
  }
  if (!registered) return;
  for (const [method, info] of Object.entries(HANDLERS)) {
    if (
      info.kind === HandlerKind.Notify &&
      info.event === eventType &&
      isFn(registered[method])
    ) {
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
    if (
      info.kind === HandlerKind.Filter &&
      info.event === eventType &&
      isFn(registered[method])
    ) {
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
    body: out.body == null ? "" : String(out.body),
  };
}

// permError builds an actionable Error and logs it to stderr (which the
// host runtime captures), so a plugin author running `owncast-plugin
// serve` or hitting the host's logs sees exactly which permission to
// add to their manifest. apiName is the SDK call the author wrote
// (e.g. "owncast.actions.set"); perm is the manifest permission string.
function permError(apiName, perm) {
  const msg = `${apiName} requires the '${perm}' permission. Add it to your plugin.manifest.json's "permissions" array.`;
  console.error(`[owncast-plugin] ${msg}`);
  return new Error(msg);
}

// scheduleTimer registers a callback and asks the host to schedule it. The id
// is guest-allocated and echoed back on "timer.fire". Throws if the host
// rejects the schedule (per-plugin pending-timer cap).
function scheduleTimer(fn, ms, repeat) {
  if (typeof fn !== "function") {
    throw new Error("owncast.timer: callback must be a function");
  }
  const id = nextTimerId++;
  const delay = Math.max(0, Math.floor(Number(ms) || 0));
  const fns = Host.getFunctions();
  if (!fns.owncast_timer_set) {
    throw new Error("owncast.timer is unavailable in this host");
  }
  const ok = fns.owncast_timer_set(BigInt(id), BigInt(delay), repeat ? 1 : 0);
  if (ok !== 1) {
    throw new Error("owncast.timer: too many pending timers");
  }
  timerCallbacks.set(id, { fn, repeat });
  return id;
}

const owncast = {
  chat: {
    send(text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_send_chat)
        throw new Error(`permission '${Permissions.ChatSend}' not granted`);
      fns.owncast_send_chat(Memory.fromString(text).offset);
    },
    sendAction(text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_send_chat_action)
        throw new Error(`permission '${Permissions.ChatSend}' not granted`);
      fns.owncast_send_chat_action(Memory.fromString(text).offset);
    },
    system(body) {
      const fns = Host.getFunctions();
      if (!fns.owncast_send_chat_system)
        throw new Error(`permission '${Permissions.ChatSend}' not granted`);
      fns.owncast_send_chat_system(Memory.fromString(body).offset);
    },
    history(limit) {
      const fns = Host.getFunctions();
      if (!fns.owncast_chat_history)
        throw new Error(`permission '${Permissions.ChatHistory}' not granted`);
      const offset = fns.owncast_chat_history(limit || 0);
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    deleteMessage(messageId) {
      const fns = Host.getFunctions();
      if (!fns.owncast_delete_message)
        throw new Error(`permission '${Permissions.ChatModerate}' not granted`);
      fns.owncast_delete_message(Memory.fromString(String(messageId)).offset);
    },
    kick(clientId) {
      const fns = Host.getFunctions();
      if (!fns.owncast_kick_client)
        throw new Error(`permission '${Permissions.ChatModerate}' not granted`);
      fns.owncast_kick_client(BigInt(clientId));
    },
    sendTo(clientId, text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_send_chat_to)
        throw new Error(`permission '${Permissions.ChatSend}' not granted`);
      fns.owncast_send_chat_to(
        BigInt(clientId),
        Memory.fromString(text).offset,
      );
    },
    // replyTo whispers text back to whoever sent a chat message. Pass the
    // ChatMessage from onChatMessage/filterChatMessage (or a bare clientId).
    // Returns true if the sender's connection was known and the reply sent,
    // false otherwise (e.g. the message carried no clientId) — letting callers
    // fall back to a public post.
    replyTo(msgOrClientId, text) {
      const clientId =
        msgOrClientId && typeof msgOrClientId === "object"
          ? msgOrClientId.clientId
          : msgOrClientId;
      if (clientId === undefined || clientId === null) return false;
      this.sendTo(clientId, text);
      return true;
    },
    clients() {
      const fns = Host.getFunctions();
      if (!fns.owncast_chat_clients)
        throw new Error(`permission '${Permissions.ChatHistory}' not granted`);
      const offset = fns.owncast_chat_clients();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  users: {
    list() {
      const fns = Host.getFunctions();
      if (!fns.owncast_users_list)
        throw new Error(`permission '${Permissions.UsersRead}' not granted`);
      const offset = fns.owncast_users_list();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    get(id) {
      const fns = Host.getFunctions();
      if (!fns.owncast_user_get)
        throw new Error(`permission '${Permissions.UsersRead}' not granted`);
      const offset = fns.owncast_user_get(Memory.fromString(id).offset);
      if (offset == 0) return null;
      return JSON.parse(Memory.find(offset).readString());
    },
    setEnabled(id, enabled, reason) {
      const fns = Host.getFunctions();
      if (!fns.owncast_user_set_enabled)
        throw new Error(
          `permission '${Permissions.UsersModerate}' not granted`,
        );
      fns.owncast_user_set_enabled(
        Memory.fromString(id).offset,
        enabled ? 1 : 0,
        Memory.fromString(reason || "").offset,
      );
    },
    banIP(ip) {
      const fns = Host.getFunctions();
      if (!fns.owncast_ban_ip)
        throw new Error(
          `permission '${Permissions.UsersModerate}' not granted`,
        );
      fns.owncast_ban_ip(Memory.fromString(ip).offset);
    },
  },
  storage: {
    upload(name, data) {
      const fns = Host.getFunctions();
      if (!fns.owncast_storage_upload)
        throw new Error(
          `permission '${Permissions.StorageUpload}' not granted`,
        );
      const dataMem =
        data instanceof Uint8Array
          ? Memory.fromBuffer(
              data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength,
              ),
            )
          : Memory.fromString(String(data));
      const offset = fns.owncast_storage_upload(
        Memory.fromString(name).offset,
        dataMem.offset,
      );
      if (offset == 0) return null;
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  // Private, sandboxed filesystem under data/plugin-data/<slug>/. Unlike
  // storage.upload (which publishes browser-accessible files), these bytes
  // stay server-side. The host confines every path to this plugin's own
  // directory. All methods require the 'storage.fs' permission.
  fs: {
    // Read a file's raw bytes. Returns a Uint8Array, or null if the file
    // doesn't exist (or can't be read).
    read(path) {
      const fns = Host.getFunctions();
      if (!fns.owncast_fs_read)
        throw new Error(`permission '${Permissions.StorageFS}' not granted`);
      const offset = fns.owncast_fs_read(Memory.fromString(path).offset);
      if (offset == 0) return null;
      return new Uint8Array(Memory.find(offset).readBytes());
    },
    // Read a file as UTF-8 text. Returns a string, or null if the file
    // doesn't exist. (The Extism boundary decodes the bytes as UTF-8.)
    readText(path) {
      const fns = Host.getFunctions();
      if (!fns.owncast_fs_read)
        throw new Error(`permission '${Permissions.StorageFS}' not granted`);
      const offset = fns.owncast_fs_read(Memory.fromString(path).offset);
      if (offset == 0) return null;
      return Memory.find(offset).readString();
    },
    // Write bytes (Uint8Array) or a string to a file, creating parent
    // directories as needed. Returns { ok, error? }.
    write(path, data) {
      const fns = Host.getFunctions();
      if (!fns.owncast_fs_write)
        throw new Error(`permission '${Permissions.StorageFS}' not granted`);
      const dataMem =
        data instanceof Uint8Array
          ? Memory.fromBuffer(
              data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength,
              ),
            )
          : Memory.fromString(String(data));
      const offset = fns.owncast_fs_write(
        Memory.fromString(path).offset,
        dataMem.offset,
      );
      if (offset == 0) return { ok: false, error: "write failed" };
      return JSON.parse(Memory.find(offset).readString());
    },
    // List the entry names (files and subdirectories) directly inside dir.
    // A missing directory lists as empty. Returns string[].
    list(dir) {
      const fns = Host.getFunctions();
      if (!fns.owncast_fs_list)
        throw new Error(`permission '${Permissions.StorageFS}' not granted`);
      const offset = fns.owncast_fs_list(Memory.fromString(dir || "").offset);
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    // Remove a single file or empty directory. Returns { ok, error? }.
    delete(path) {
      const fns = Host.getFunctions();
      if (!fns.owncast_fs_delete)
        throw new Error(`permission '${Permissions.StorageFS}' not granted`);
      const offset = fns.owncast_fs_delete(Memory.fromString(path).offset);
      if (offset == 0) return { ok: false, error: "delete failed" };
      return JSON.parse(Memory.find(offset).readString());
    },
    // Report whether a path exists inside the sandbox. Returns boolean.
    exists(path) {
      const fns = Host.getFunctions();
      if (!fns.owncast_fs_exists)
        throw new Error(`permission '${Permissions.StorageFS}' not granted`);
      return fns.owncast_fs_exists(Memory.fromString(path).offset) === 1;
    },
  },
  fediverse: {
    /** Publish a public text-only post to the fediverse on the streamer's
     *  behalf. Returns { url } on success, null on failure (rate-limited,
     *  disabled by admin, etc.). Requires `fediverse.post`. */
    post(text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_fediverse_post)
        throw new Error(
          `permission '${Permissions.FediversePost}' not granted`,
        );
      const offset = fns.owncast_fediverse_post(Memory.fromString(text).offset);
      if (offset == 0) return null;
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  notifications: {
    discord(text) {
      const fns = Host.getFunctions();
      if (!fns.owncast_notify_discord)
        throw new Error(
          `permission '${Permissions.NotificationsSend}' not granted`,
        );
      fns.owncast_notify_discord(Memory.fromString(text).offset);
    },
    browserPush(payload) {
      const fns = Host.getFunctions();
      if (!fns.owncast_notify_browser_push)
        throw new Error(
          `permission '${Permissions.NotificationsSend}' not granted`,
        );
      const obj = typeof payload === "string" ? { title: payload } : payload;
      fns.owncast_notify_browser_push(
        Memory.fromString(JSON.stringify(obj)).offset,
      );
    },
    fediverse(payload) {
      const fns = Host.getFunctions();
      if (!fns.owncast_notify_fediverse)
        throw new Error(
          `permission '${Permissions.NotificationsSend}' not granted`,
        );
      fns.owncast_notify_fediverse(
        Memory.fromString(JSON.stringify(payload)).offset,
      );
    },
  },
  stream: {
    current() {
      const fns = Host.getFunctions();
      if (!fns.owncast_stream_current)
        throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_stream_current();
      if (offset == 0) return { online: false, viewers: 0 };
      return JSON.parse(Memory.find(offset).readString());
    },
    broadcaster() {
      const fns = Host.getFunctions();
      if (!fns.owncast_stream_broadcaster)
        throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_stream_broadcaster();
      if (offset == 0) return {};
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  server: {
    info() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_info)
        throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_info();
      if (offset == 0) return {};
      return JSON.parse(Memory.find(offset).readString());
    },
    socials() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_socials)
        throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_socials();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    emotes() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_emotes)
        throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_emotes();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    federation() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_federation)
        throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_federation();
      if (offset == 0) return { enabled: false };
      return JSON.parse(Memory.find(offset).readString());
    },
    tags() {
      const fns = Host.getFunctions();
      if (!fns.owncast_server_tags)
        throw new Error(`permission '${Permissions.ServerRead}' not granted`);
      const offset = fns.owncast_server_tags();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  videoConfig: {
    /** Read the current video/transcoding config: { latencyLevel, codec,
     *  variants }. Requires `videoconfig.read`. */
    read() {
      const fns = Host.getFunctions();
      if (!fns.owncast_video_config_read)
        throw new Error(
          `permission '${Permissions.VideoConfigRead}' not granted`,
        );
      const offset = fns.owncast_video_config_read();
      if (offset == 0) return { latencyLevel: 0, codec: "", variants: [] };
      return JSON.parse(Memory.find(offset).readString());
    },
    /** Apply a partial video config change. Pass any of { latencyLevel, codec,
     *  variants }; omitted fields are left unchanged. Throws if the host
     *  rejects the config. Requires `videoconfig.write`. */
    write(config) {
      const fns = Host.getFunctions();
      if (!fns.owncast_video_config_write)
        throw new Error(
          `permission '${Permissions.VideoConfigWrite}' not granted`,
        );
      const offset = fns.owncast_video_config_write(
        Memory.fromString(JSON.stringify(config || {})).offset,
      );
      if (offset == 0) throw new Error("videoConfig.write failed");
      const result = JSON.parse(Memory.find(offset).readString());
      if (!result.ok)
        throw new Error(result.error || "videoConfig.write failed");
    },
  },
  kv: {
    get(key) {
      const fns = Host.getFunctions();
      if (!fns.owncast_kv_get)
        throw new Error(`permission '${Permissions.StorageKV}' not granted`);
      const offset = fns.owncast_kv_get(Memory.fromString(key).offset);
      if (offset == 0) return null;
      return Memory.find(offset).readString();
    },
    set(key, value) {
      const fns = Host.getFunctions();
      if (!fns.owncast_kv_set)
        throw new Error(`permission '${Permissions.StorageKV}' not granted`);
      fns.owncast_kv_set(
        Memory.fromString(key).offset,
        Memory.fromString(String(value)).offset,
      );
    },
    // getJSON/setJSON are convenience wrappers over the string-only store, so
    // plugins don't reimplement JSON.parse/stringify for every stored object.
    // getJSON returns `fallback` (default undefined) when the key is unset or
    // holds invalid JSON.
    getJSON(key, fallback) {
      const raw = this.get(key);
      if (raw == null) return fallback;
      try {
        return JSON.parse(raw);
      } catch (_e) {
        return fallback;
      }
    },
    setJSON(key, value) {
      this.set(key, JSON.stringify(value));
    },
  },
  config: {
    // get returns the effective value of a manifest-declared config key (the
    // admin-set override, else the declared default), already parsed to its
    // declared type. Returns `fallback` (default undefined) for an unknown key
    // or one with no value. Ambient — no permission required.
    get(key, fallback) {
      const fns = Host.getFunctions();
      const offset = fns.owncast_config_get(Memory.fromString(key).offset);
      if (offset == 0) return fallback;
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  // Read files the plugin shipped in its own assets/ directory. Useful for
  // templates, data files, and other bundled resources that need to be read
  // at request time. Path is relative to assets/ and must not contain "..".
  // Ambient — no permission required.
  assets: {
    // Returns a Uint8Array of the file's raw bytes, or null if not found.
    read(path) {
      const fns = Host.getFunctions();
      const offset = fns.owncast_asset_read(Memory.fromString(path).offset);
      if (offset == 0) return null;
      return new Uint8Array(Memory.find(offset).readBytes());
    },
    // Returns the file contents as a UTF-8 string, or null if not found.
    readText(path) {
      const fns = Host.getFunctions();
      const offset = fns.owncast_asset_read(Memory.fromString(path).offset);
      if (offset == 0) return null;
      return Memory.find(offset).readString();
    },
  },
  events: {
    emit(eventType, payload) {
      const fns = Host.getFunctions();
      if (!fns.owncast_emit_event)
        throw new Error(`permission '${Permissions.EventsEmit}' not granted`);
      fns.owncast_emit_event(
        Memory.fromString(eventType).offset,
        Memory.fromString(JSON.stringify(payload)).offset,
      );
    },
  },
  actions: {
    // Append one or more action buttons to the plugin's effective list
    // (manifest.actions ++ runtime additions). Accepts a single button
    // object or an array. The host validates each entry (title
    // required, exactly one of url/html, relative URLs rewritten into
    // this plugin's namespace, cross-plugin URLs rejected) and persists
    // the result, so the next /api/config request returns the longer
    // list. Requires 'ui.modify'.
    add(actions) {
      const fns = Host.getFunctions();
      if (!fns.owncast_add_actions)
        throw permError("owncast.actions.add", Permissions.UIModify);
      const list = Array.isArray(actions) ? actions : [actions];
      fns.owncast_add_actions(Memory.fromString(JSON.stringify(list)).offset);
    },
    // Drop the runtime additions so only manifest.actions remain in
    // the effective list on the next /api/config request. Requires
    // 'ui.modify'.
    clear() {
      const fns = Host.getFunctions();
      if (!fns.owncast_clear_actions)
        throw permError("owncast.actions.clear", Permissions.UIModify);
      fns.owncast_clear_actions();
    },
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
      if (!fns.owncast_sse_send)
        throw new Error(`permission '${Permissions.HttpSSE}' not granted`);
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      fns.owncast_sse_send(
        Memory.fromString(channel || "").offset,
        Memory.fromString(event || "").offset,
        Memory.fromString(payload).offset,
      );
    },
  },
  timer: {
    // setTimeout(fn, ms) runs fn once after ~ms milliseconds. setInterval
    // repeats until clear(id). The host drives the schedule (the sandbox has
    // no setTimeout); your callback runs in this instance when it fires.
    // Returns an id for clear(). Very small delays are clamped up by the host,
    // and there's a per-plugin cap on pending timers (throws past it).
    // Note: timers are in-memory and do not survive a plugin reload or a host
    // restart. No permission required.
    setTimeout(fn, ms) {
      return scheduleTimer(fn, ms, false);
    },
    setInterval(fn, ms) {
      return scheduleTimer(fn, ms, true);
    },
    clear(id) {
      timerCallbacks.delete(id);
      const fns = Host.getFunctions();
      if (fns.owncast_timer_clear) fns.owncast_timer_clear(BigInt(id));
    },
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
        headers: opts.headers || {},
      };
      const body = opts.body != null ? String(opts.body) : null;
      const res = body != null ? Http.request(req, body) : Http.request(req);
      return {
        status: res.status,
        headers: res.headers || {},
        body: res.body || "",
      };
    },
  },
};

function dispatchTabContent(req) {
  if (!registered || !isFn(registered.onTabContent)) return "";
  return registered.onTabContent(req) || "";
}

function dispatchPageContent(req) {
  if (!registered || !isFn(registered.onPageContent)) return "";
  return registered.onPageContent(req) || "";
}

module.exports = {
  definePlugin,
  defineCommands,
  owncast,
  filter,
  FilterAction,
  Events,
  Permissions,
  describeSubscriptions,
  dispatchEvent,
  dispatchFilter,
  dispatchHttp,
  dispatchTabContent,
  dispatchPageContent,
};
