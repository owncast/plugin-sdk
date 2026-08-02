// @owncast/plugin-sdk runtime, bundled into every plugin.
//
// Authors define typed handlers (onChatMessage, filterChatMessage, ...) plus
// an `on: { [customEvent]: handler }` object for plugin-emitted events. The
// SDK derives the manifest's subscriptions from which handlers are present
// and returns them via register(). Authors don't maintain a duplicate list.

let registered = null;

// Command registrations used for matching, dispatch, and the unified `!help`.
const commandManifest = [];

// Host-driven timers. The sandbox has no setTimeout, so owncast.timer.* asks
// the host to schedule a callback and call back via the internal "timer.fire"
// event. The author's callback stays here in the long-lived instance, keyed by
// a guest-allocated id the host echoes back. State persists across calls
// because the plugin instance is reused. Timers are dropped on reload.
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
  FediverseActivity: "fediverse.activity",
  FediverseFollow: "fediverse.follow",
  FediverseLike: "fediverse.like",
  FediverseRepost: "fediverse.repost",
  FediverseQuote: "fediverse.quote",
  FediverseMention: "fediverse.mention",
  FediverseReply: "fediverse.reply",
});

const InternalEvents = Object.freeze({
  ChatCommand: "chat.command",
  TimerFire: "timer.fire",
});

const DefaultCommandPrefix = "!";

const Permissions = Object.freeze({
  ChatSend: "chat.send",
  ChatHistory: "chat.history",
  ChatModerate: "chat.moderate",
  ChatFilter: "chat.filter",
  StorageKV: "storage.kv",
  StorageUpload: "storage.upload",
  StorageFS: "storage.fs",
  StorageSQL: "storage.sql",
  EventsEmit: "events.emit",
  NetworkFetch: "network.fetch",
  HttpServe: "http.serve",
  ServerRead: "server.read",
  NotificationsSend: "notifications.send",
  UsersRead: "users.read",
  UsersModerate: "users.moderate",
  UsersRegister: "users.register",
  AuthGate: "auth.gate",
  FediversePost: "fediverse.post",
  FediverseInbound: "fediverse.inbound",
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

// Verdict helpers for onAuthCheck (the optional re-validation hook the host runs
// on a viewer's page load). `ok` keeps the session, `refresh` keeps it and
// extends the cookie (optional `ttl` seconds), and `deny` ends it and bounces
// the viewer back to the login screen.
const authCheck = Object.freeze({
  ok() {
    return { action: "ok" };
  },
  refresh(opts) {
    return { action: "refresh", ...(opts || {}) };
  },
  deny(reason) {
    return { action: "deny", reason: reason || "" };
  },
});

// dispatchAuthCheck routes the host's re-validation call to the author's
// onAuthCheck handler. No handler → always "ok" (the hook is optional, and a
// plugin that doesn't implement it simply never revokes mid-session).
function dispatchAuthCheck(req) {
  if (!registered || !isFn(registered.onAuthCheck)) return { action: "ok" };
  return registered.onAuthCheck(req) || { action: "ok" };
}

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
  // Verified inbound ActivityPub activity (raw JSON object)
  onFediverse: {
    event: Events.FediverseActivity,
    kind: HandlerKind.Notify,
  },
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
  onFediverseQuote: {
    event: Events.FediverseQuote,
    kind: HandlerKind.Notify,
  },
  // Fediverse inbound posts (with content)
  onFediverseMention: {
    event: Events.FediverseMention,
    kind: HandlerKind.Notify,
  },
  onFediverseReply: { event: Events.FediverseReply, kind: HandlerKind.Notify },
});

const isFn = (x) => typeof x === "function";
const isObj = (x) => x !== null && typeof x === "object";

function definePlugin(def) {
  registered = def;
  commandManifest.length = 0;
  if (!def || !isObj(def.commands)) return def;

  const prefix =
    def.commandPrefix == null ? DefaultCommandPrefix : def.commandPrefix;
  if (typeof prefix !== "string" || prefix.length === 0) {
    throw new TypeError("commandPrefix must be a non-empty string");
  }
  const caseSensitive = !!def.commandsCaseSensitive;
  for (const name of Object.keys(def.commands)) {
    const command = def.commands[name];
    if (!isObj(command)) {
      throw new TypeError(`command "${name}" must be an object`);
    }
    const aliases = command.aliases == null ? [] : command.aliases;
    if (
      !Array.isArray(aliases) ||
      !aliases.every((alias) => typeof alias === "string")
    ) {
      throw new TypeError(`command "${name}" aliases must be an array of strings`);
    }
    const cooldownMs =
      command.cooldownMs == null ? 0 : command.cooldownMs;
    if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0) {
      throw new TypeError(`command "${name}" cooldownMs must be a non-negative integer`);
    }
    commandManifest.push({
      name,
      prefix,
      description: command.description || "",
      usage: command.usage || "",
      aliases,
      modOnly: !!command.modOnly,
      caseSensitive,
      cooldownMs,
    });
  }
  return def;
}

function dispatchCommand(event) {
  if (!isObj(event)) return;
  if (!registered || !isObj(registered.commands)) return;
  const command = registered.commands[event.command];
  if (!command || !isFn(command.run)) return;

  const msg = event.message;
  command.run({
    msg,
    user: msg && msg.user,
    command: event.command,
    invokedAs: event.invokedAs || event.command,
    args: event.args || [],
    argString: event.argString || "",
    reply: (text) => owncast.chat.send(text),
    replyPrivately: (text) => {
      if (!owncast.chat.replyTo(msg, text)) owncast.chat.send(text);
    },
  });
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

// Used by the build-generated entry to report command registrations to the
// host for matching, dispatch, and the unified `!help`.
function describeCommands() {
  return commandManifest;
}

function dispatchEvent(envelope) {
  const { eventType, payload } = envelope;
  // Internal: a host-scheduled timer elapsed. Run the author's callback,
  // dropping one-shot entries first so a throw still cleans up. Not routed to
  // user handlers or the `on` map.
  if (eventType === InternalEvents.TimerFire) {
    const id = payload && payload.id;
    const entry = timerCallbacks.get(id);
    if (entry) {
      if (!entry.repeat) timerCallbacks.delete(id);
      entry.fn();
    }
    return;
  }
  if (eventType === InternalEvents.ChatCommand) {
    dispatchCommand(payload);
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
// (e.g. "owncast.actions.set"). perm is the manifest permission string.
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

// hostFns returns the host import table, throwing an actionable error if the
// named function wasn't granted (the plugin's manifest is missing its
// permission). This is the per-call guard every owncast.* method used to inline.
function hostFns(name, perm) {
  const fns = Host.getFunctions();
  if (!fns[name]) throw new Error(`permission '${perm}' not granted`);
  return fns;
}

function operationResult(offset, failureMessage) {
  if (offset == 0) return { error: failureMessage };
  try {
    const result = JSON.parse(Memory.find(offset).readString());
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      return { error: failureMessage };
    }
    return result;
  } catch {
    return { error: failureMessage };
  }
}

function requireOperationResult(offset, failureMessage) {
  const result = operationResult(offset, failureMessage);
  if (Object.prototype.hasOwnProperty.call(result, "error")) {
    throw new Error(result.error || failureMessage);
  }
  return result;
}

function sqlResult(offset) {
  return requireOperationResult(offset, "SQL host call failed");
}

function sqlRows(result) {
  if (!Array.isArray(result.columns) || !Array.isArray(result.rows)) {
    throw new Error("SQL host returned an invalid result");
  }
  return result.rows.map((values) => {
    if (!Array.isArray(values)) {
      throw new Error("SQL host returned an invalid result");
    }
    return Object.fromEntries(result.columns.map((column, i) => [column, values[i]]));
  });
}

function sqlQuery(sql, params, maxRows) {
  const fns = hostFns("owncast_sql_query", Permissions.StorageSQL);
  const payload = { sql: String(sql), params: Array.from(params || []) };
  if (maxRows) payload.maxRows = maxRows;
  const request = Memory.fromString(JSON.stringify(payload));
  return sqlResult(fns.owncast_sql_query(request.offset));
}

function logToHost(name, message) {
  const fn = Host.getFunctions()[name];
  if (!fn) throw new Error("owncast.log is unavailable in this host");
  fn(Memory.fromString(String(message)).offset);
}

const owncast = {
  log: {
    info(message) {
      logToHost("owncast_log_info", message);
    },
    warning(message) {
      logToHost("owncast_log_warning", message);
    },
    error(message) {
      logToHost("owncast_log_error", message);
    },
  },
  chat: {
    send(text) {
      const fns = hostFns("owncast_send_chat", Permissions.ChatSend);
      fns.owncast_send_chat(Memory.fromString(text).offset);
    },
    sendAction(text) {
      const fns = hostFns("owncast_send_chat_action", Permissions.ChatSend);
      fns.owncast_send_chat_action(Memory.fromString(text).offset);
    },
    system(body) {
      const fns = hostFns("owncast_send_chat_system", Permissions.ChatSend);
      fns.owncast_send_chat_system(Memory.fromString(body).offset);
    },
    history(limit) {
      const fns = hostFns("owncast_chat_history", Permissions.ChatHistory);
      const offset = fns.owncast_chat_history(limit || 0);
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    deleteMessage(messageId) {
      const fns = hostFns("owncast_delete_message", Permissions.ChatModerate);
      fns.owncast_delete_message(Memory.fromString(String(messageId)).offset);
    },
    kick(clientId) {
      const fns = hostFns("owncast_kick_client", Permissions.ChatModerate);
      fns.owncast_kick_client(BigInt(clientId));
    },
    sendTo(clientId, text) {
      const fns = hostFns("owncast_send_chat_to", Permissions.ChatSend);
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
      const fns = hostFns("owncast_chat_clients", Permissions.ChatHistory);
      const offset = fns.owncast_chat_clients();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  users: {
    list() {
      const fns = hostFns("owncast_users_list", Permissions.UsersRead);
      const offset = fns.owncast_users_list();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    get(id) {
      const fns = hostFns("owncast_user_get", Permissions.UsersRead);
      const offset = fns.owncast_user_get(Memory.fromString(id).offset);
      if (offset == 0) return null;
      return JSON.parse(Memory.find(offset).readString());
    },
    setEnabled(id, enabled, reason) {
      const fns = hostFns("owncast_user_set_enabled", Permissions.UsersModerate);
      fns.owncast_user_set_enabled(
        Memory.fromString(id).offset,
        enabled ? 1 : 0,
        Memory.fromString(reason || "").offset,
      );
    },
    banIP(ip) {
      const fns = hostFns("owncast_ban_ip", Permissions.UsersModerate);
      fns.owncast_ban_ip(Memory.fromString(ip).offset);
    },
    // Find-or-create an authenticated Owncast user for an external identity
    // (e.g. a provider account). `authId` is the stable provider-scoped id. The
    // host namespaces it by this plugin's slug so it can't collide with or spoof
    // another plugin's users. Optionally seeds displayName and scopes. Returns
    // { userId }. Throws on host error. Requires `users.register`.
    register(opts) {
      const fns = hostFns("owncast_users_register", Permissions.UsersRegister);
      const req =
        typeof opts === "string" ? { authId: opts } : opts || {};
      const offset = fns.owncast_users_register(
        Memory.fromString(JSON.stringify(req)).offset,
      );
      if (offset == 0) throw new Error("users.register failed");
      const result = JSON.parse(Memory.find(offset).readString());
      if (result.error) throw new Error(result.error);
      return result; // { userId }
    },
  },
  // Viewer-authentication gate. Only a plugin holding `auth.gate` (and enabled by
  // an admin) can issue sessions, and these are valid only inside onHttpRequest,
  // where the host attaches/clears the signed session cookie on the response.
  // The admin selects the cumulative, host-owned access mode. Plugins cannot
  // read or change it.
  auth: {
    // Issue a gate session for an already-registered user (see users.register).
    // `ttl` is optional seconds, and 0/omitted uses the host default. Throws on
    // host error. Requires `auth.gate`.
    grantSession(opts) {
      const fns = hostFns("owncast_auth_grant_session", Permissions.AuthGate);
      const req = typeof opts === "string" ? { userId: opts } : opts || {};
      const offset = fns.owncast_auth_grant_session(
        Memory.fromString(JSON.stringify(req)).offset,
      );
      if (offset == 0) throw new Error("auth.grantSession failed");
      const result = JSON.parse(Memory.find(offset).readString());
      if (result.error) throw new Error(result.error);
    },
    // Clear the current viewer's gate session (logout). The plugin still owns the
    // response/redirect. Requires `auth.gate`.
    endSession() {
      const fns = hostFns("owncast_auth_end_session", Permissions.AuthGate);
      fns.owncast_auth_end_session();
    },
  },
  storage: {
    upload(name, data) {
      const fns = hostFns("owncast_storage_upload", Permissions.StorageUpload);
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
  // Private, sandboxed filesystem under data/plugin-storage/<slug>/files/. Unlike
  // storage.upload (which publishes browser-accessible files), these bytes
  // stay server-side. The host confines every path to this plugin's own
  // directory. All methods require the 'storage.fs' permission.
  fs: {
    // Read a file's raw bytes. Returns a Uint8Array, or null if the file
    // doesn't exist (or can't be read).
    read(path) {
      const fns = hostFns("owncast_fs_read", Permissions.StorageFS);
      const offset = fns.owncast_fs_read(Memory.fromString(path).offset);
      if (offset == 0) return null;
      return new Uint8Array(Memory.find(offset).readBytes());
    },
    // Read a file as UTF-8 text. Returns a string, or null if the file
    // doesn't exist. (The Extism boundary decodes the bytes as UTF-8.)
    readText(path) {
      const fns = hostFns("owncast_fs_read", Permissions.StorageFS);
      const offset = fns.owncast_fs_read(Memory.fromString(path).offset);
      if (offset == 0) return null;
      return Memory.find(offset).readString();
    },
    // Write bytes (Uint8Array) or a string to a file, creating parent
    // directories as needed. Returns { error? }.
    write(path, data) {
      const fns = hostFns("owncast_fs_write", Permissions.StorageFS);
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
      return operationResult(offset, "write failed");
    },
    // List the entry names (files and subdirectories) directly inside dir.
    // A missing directory lists as empty. Returns string[].
    list(dir) {
      const fns = hostFns("owncast_fs_list", Permissions.StorageFS);
      const offset = fns.owncast_fs_list(Memory.fromString(dir || "").offset);
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    // Remove a single file or empty directory. Returns { error? }.
    delete(path) {
      const fns = hostFns("owncast_fs_delete", Permissions.StorageFS);
      const offset = fns.owncast_fs_delete(Memory.fromString(path).offset);
      return operationResult(offset, "delete failed");
    },
    // Report whether a path exists inside the sandbox. Returns boolean.
    exists(path) {
      const fns = hostFns("owncast_fs_exists", Permissions.StorageFS);
      return fns.owncast_fs_exists(Memory.fromString(path).offset) === 1;
    },
  },
  sql: {
    exec(sql, params = []) {
      const fns = hostFns("owncast_sql_exec", Permissions.StorageSQL);
      const request = Memory.fromString(
        JSON.stringify({ sql: String(sql), params: Array.from(params || []) }),
      );
      return sqlResult(fns.owncast_sql_exec(request.offset));
    },
    query(sql, params = []) {
      return sqlRows(sqlQuery(sql, params));
    },
    queryRow(sql, params = []) {
      // Asking the host for one row keeps a first-row read off the result
      // budget, so this works against a table `query` would be too big for.
      return sqlRows(sqlQuery(sql, params, 1))[0] || null;
    },
  },
  fediverse: {
    /** Publish a public text-only post to the fediverse on the streamer's
     *  behalf. Returns { url } on success, null on failure (rate-limited,
     *  disabled by admin, etc.). Requires `fediverse.post`. */
    post(text) {
      const fns = hostFns("owncast_fediverse_post", Permissions.FediversePost);
      const offset = fns.owncast_fediverse_post(Memory.fromString(text).offset);
      if (offset == 0) return null;
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  notifications: {
    discord(text) {
      const fns = hostFns("owncast_notify_discord", Permissions.NotificationsSend);
      fns.owncast_notify_discord(Memory.fromString(text).offset);
    },
    browserPush(payload) {
      const fns = hostFns("owncast_notify_browser_push", Permissions.NotificationsSend);
      const obj = typeof payload === "string" ? { title: payload } : payload;
      fns.owncast_notify_browser_push(
        Memory.fromString(JSON.stringify(obj)).offset,
      );
    },
    fediverse(payload) {
      const fns = hostFns("owncast_notify_fediverse", Permissions.NotificationsSend);
      fns.owncast_notify_fediverse(
        Memory.fromString(JSON.stringify(payload)).offset,
      );
    },
  },
  stream: {
    current() {
      const fns = hostFns("owncast_stream_current", Permissions.ServerRead);
      const offset = fns.owncast_stream_current();
      if (offset == 0) return { online: false, viewers: 0 };
      return JSON.parse(Memory.find(offset).readString());
    },
    broadcaster() {
      const fns = hostFns("owncast_stream_broadcaster", Permissions.ServerRead);
      const offset = fns.owncast_stream_broadcaster();
      if (offset == 0) return {};
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  server: {
    info() {
      const fns = hostFns("owncast_server_info", Permissions.ServerRead);
      const offset = fns.owncast_server_info();
      if (offset == 0) return {};
      return JSON.parse(Memory.find(offset).readString());
    },
    socials() {
      const fns = hostFns("owncast_server_socials", Permissions.ServerRead);
      const offset = fns.owncast_server_socials();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    emotes() {
      const fns = hostFns("owncast_server_emotes", Permissions.ServerRead);
      const offset = fns.owncast_server_emotes();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
    federation() {
      const fns = hostFns("owncast_server_federation", Permissions.ServerRead);
      const offset = fns.owncast_server_federation();
      if (offset == 0) return { enabled: false };
      return JSON.parse(Memory.find(offset).readString());
    },
    tags() {
      const fns = hostFns("owncast_server_tags", Permissions.ServerRead);
      const offset = fns.owncast_server_tags();
      if (offset == 0) return [];
      return JSON.parse(Memory.find(offset).readString());
    },
  },
  videoConfig: {
    /** Read the current video/transcoding config: { latencyLevel, codec,
     *  variants }. Requires `videoconfig.read`. */
    read() {
      const fns = hostFns("owncast_video_config_read", Permissions.VideoConfigRead);
      const offset = fns.owncast_video_config_read();
      if (offset == 0) return { latencyLevel: 0, codec: "", variants: [] };
      return JSON.parse(Memory.find(offset).readString());
    },
    /** Apply a partial video config change. Pass any of { latencyLevel, codec,
     *  variants }, where omitted fields are left unchanged. Throws if the host
     *  rejects the config. Requires `videoconfig.write`. */
    write(config) {
      const fns = hostFns("owncast_video_config_write", Permissions.VideoConfigWrite);
      const offset = fns.owncast_video_config_write(
        Memory.fromString(JSON.stringify(config || {})).offset,
      );
      requireOperationResult(offset, "videoConfig.write failed");
    },
  },
  kv: {
    get(key) {
      const fns = hostFns("owncast_kv_get", Permissions.StorageKV);
      const offset = fns.owncast_kv_get(Memory.fromString(key).offset);
      if (offset == 0) return null;
      return Memory.find(offset).readString();
    },
    set(key, value) {
      const fns = hostFns("owncast_kv_set", Permissions.StorageKV);
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
      const fns = hostFns("owncast_emit_event", Permissions.EventsEmit);
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
    // source.addEventListener(event, ...)). Pass "" for the default
    // "message" event. `data` is sent as-is if it's a string, otherwise
    // JSON-stringified. Fire-and-forget: returns immediately, and frames to
    // a slow client are dropped rather than blocking the plugin. Requires
    // the 'http.sse' permission.
    send(channel, event, data) {
      const fns = hostFns("owncast_sse_send", Permissions.HttpSSE);
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
    // no setTimeout). Your callback runs in this instance when it fires.
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

function dispatchPageStyles() {
  if (!registered || !isFn(registered.onPageStyles)) return "";
  return registered.onPageStyles() || "";
}

function dispatchPageScripts() {
  if (!registered || !isFn(registered.onPageScripts)) return "";
  return registered.onPageScripts() || "";
}

module.exports = {
  definePlugin,
  owncast,
  filter,
  authCheck,
  FilterAction,
  Events,
  Permissions,
  describeSubscriptions,
  describeCommands,
  dispatchEvent,
  dispatchFilter,
  dispatchHttp,
  dispatchAuthCheck,
  dispatchTabContent,
  dispatchPageContent,
  dispatchPageStyles,
  dispatchPageScripts,
};
