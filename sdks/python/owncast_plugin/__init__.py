"""Owncast plugin SDK for Python.

Author a plugin by importing this module, registering handlers with the
``plugin`` decorators, calling the host through ``owncast``, and returning
``filter`` results from filter handlers:

    from owncast_plugin import plugin, owncast, filter

    @plugin.on_chat_message
    def greet(msg):
        owncast.chat.send(f"hi {msg.user.display_name}")

Plugins ship as source and run on a Python engine the Owncast host embeds and
shares across every plugin, so there's no compile step: the build just emits
your plugin source as `<slug>.py` and this runtime is already present as globals
in the engine. This file is also importable on your dev machine for editor
support and unit tests.
"""

# `extism` is the host-call bridge, present inside the engine the host runs the
# plugin on. Guard the import so this module stays importable on a dev machine
# (editor support / unit tests) too.
try:
    import extism  # type: ignore
except ImportError:  # pragma: no cover - dev machine, not wasm
    extism = None

import json

__all__ = ["plugin", "owncast", "filter", "auth_check", "define_commands", "CommandContext"]

# Host function table, populated by the build-injected import block (only the
# host functions the manifest's permissions grant, plus the ambient ones).
_HOST = {}


def _host(name):
    fn = _HOST.get(name)
    if fn is None:
        raise RuntimeError(
            "owncast: host function '%s' is unavailable — declare the "
            "permission it needs in plugin.manifest.json." % name
        )
    return fn


def _call_json(name, *args):
    """Call a host fn that returns a JSON (or empty) string; decode it."""
    raw = _host(name)(*args)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw


# ---------------------------------------------------------------------------
# Wire payloads: attribute views over the host's JSON (snake_case accessors map
# to camelCase wire keys; `.raw` exposes the underlying dict).
# ---------------------------------------------------------------------------
class _Obj:
    def __init__(self, data):
        self.raw = data if isinstance(data, dict) else {}

    def _get(self, *keys):
        for k in keys:
            if k in self.raw:
                return self.raw[k]
        return None

    def __getattr__(self, name):
        parts = name.split("_")
        camel = parts[0] + "".join(p.title() for p in parts[1:])
        val = self._get(name, camel)
        return _Obj(val) if isinstance(val, dict) else val


def _wrap(data, cls=_Obj):
    return cls(data) if isinstance(data, dict) else None


def _wrap_list(data, cls=_Obj):
    if not isinstance(data, list):
        return []
    return [cls(x) if isinstance(x, dict) else x for x in data]


class ChatMessage(_Obj):
    @property
    def user(self):
        return _wrap(self._get("user"))


# ---------------------------------------------------------------------------
# Handler registry + decorators.
# ---------------------------------------------------------------------------
# decorator name -> (event type, kind, payload wrapper)
_HANDLERS = {
    "on_chat_message": ("chat.message.received", "notify", ChatMessage),
    "on_chat_user_joined": ("chat.user.joined", "notify", _Obj),
    "on_chat_user_parted": ("chat.user.parted", "notify", _Obj),
    "on_chat_user_renamed": ("chat.user.renamed", "notify", _Obj),
    "on_message_moderated": ("chat.message.moderated", "notify", _Obj),
    "on_stream_started": ("stream.started", "notify", _Obj),
    "on_stream_stopped": ("stream.stopped", "notify", _Obj),
    "on_stream_title_changed": ("stream.title.changed", "notify", _Obj),
    "on_sse_connect": ("sse.connect", "notify", _Obj),
    "on_sse_disconnect": ("sse.disconnect", "notify", _Obj),
    "on_tick": ("tick", "notify", _Obj),
    "on_fediverse_follow": ("fediverse.follow", "notify", _Obj),
    "on_fediverse_like": ("fediverse.like", "notify", _Obj),
    "on_fediverse_repost": ("fediverse.repost", "notify", _Obj),
    "on_fediverse_mention": ("fediverse.mention", "notify", _Obj),
    "on_fediverse_reply": ("fediverse.reply", "notify", _Obj),
    "filter_chat_message": ("chat.message.received", "filter", ChatMessage),
}

_NOTIFY = {}    # event -> (fn, wrap)
_FILTER = {}    # event -> (fn, wrap)
_CUSTOM = {}    # custom event -> fn
_HTTP = [None]  # catch-all on_http_request handler (no path/method given)
_AUTH_CHECK = [None]  # on_auth_check handler (auth.gate session re-validation)
_ROUTES = []    # list of (method_or_"*", path, fn) for path/method routing
_TAB = {}       # slug -> fn
_PAGE = {}      # slug -> fn
_PAGE_STYLES = [None]   # on_page_styles handler (global, no slug)
_PAGE_SCRIPTS = [None]  # on_page_scripts handler (global, no slug)

# A plugin may use plugin.commands(...) AND @plugin.on_chat_message together; on
# each chat message the command router runs first, then the on_chat_message
# handler (which sees every message — guard with a prefix check if you only want
# non-command chatter). These hold the two pieces; _chat_dispatch composes them.
_COMMANDS_ROUTER = [None]  # the define_commands router, if plugin.commands() used
_CHAT_HANDLER = [None]     # the @plugin.on_chat_message handler, if registered
# Command metadata recorded by define_commands, reported to the host via
# register() so it can build a unified !help. One entry per command:
# {name, prefix, description, usage, aliases, modOnly}.
_COMMAND_META = []


def _chat_dispatch(msg):
    if _COMMANDS_ROUTER[0] is not None:
        _COMMANDS_ROUTER[0](msg)
    if _CHAT_HANDLER[0] is not None:
        _CHAT_HANDLER[0](msg)


def _install_chat_dispatch():
    # Wired whenever either a command table or an on_chat_message handler is
    # registered, so registration order doesn't matter and both compose.
    _NOTIFY["chat.message.received"] = (_chat_dispatch, ChatMessage)


def _add_route(methods, path, fn):
    if methods is None:
        _ROUTES.append(("*", path, fn))
    else:
        for m in methods:
            _ROUTES.append((m.upper(), path, fn))
_TIMERS = {}    # timer id -> (fn, repeat)
_next_timer = [1]


class _Plugin:
    def _register(self, handler_name):
        event, kind, wrap = _HANDLERS[handler_name]

        def deco(fn):
            # on_chat_message composes with plugin.commands (see _chat_dispatch)
            # rather than owning the chat.message.received slot outright.
            if event == "chat.message.received" and kind == "notify":
                _CHAT_HANDLER[0] = fn
                _install_chat_dispatch()
            else:
                (_FILTER if kind == "filter" else _NOTIFY)[event] = (fn, wrap)
            return fn

        return deco

    def on(self, event_type):
        def deco(fn):
            _CUSTOM[event_type] = fn
            return fn
        return deco

    def on_http_request(self, arg=None, *, methods=None):
        """HTTP handler. Three forms:
          @plugin.on_http_request              — catch-all (req.path/req.method parsed by you)
          @plugin.on_http_request("/api/x")    — only requests to that exact path (any method)
          @plugin.on_http_request("/api/x", methods=["GET","POST"])  — path + methods
        Routes are matched before the catch-all; the path is relative to the
        plugin's /plugins/<slug>/ root (e.g. "/api/messages")."""
        if callable(arg):  # bare @plugin.on_http_request
            _HTTP[0] = arg
            return arg

        def deco(fn):
            _add_route(methods, arg, fn)
            return fn

        return deco

    def on_auth_check(self, fn):
        """Re-validate a viewer's gate session on page load (auth.gate plugins).
        The host calls it on the viewer's `/` request with the resolved
        `req.user`; return auth_check.ok() / refresh() / deny(). Optional —
        without it a granted session lasts until its cookie expires (no
        mid-session revocation). Used bare: `@plugin.on_auth_check`."""
        _AUTH_CHECK[0] = fn
        return fn

    def route(self, path, methods=None):
        """Register an HTTP handler for `path` (and optionally specific methods)."""
        def deco(fn):
            _add_route(methods, path, fn)
            return fn
        return deco

    def get(self, path):
        return self.route(path, ["GET"])

    def post(self, path):
        return self.route(path, ["POST"])

    def put(self, path):
        return self.route(path, ["PUT"])

    def delete(self, path):
        return self.route(path, ["DELETE"])

    def patch(self, path):
        return self.route(path, ["PATCH"])

    def on_tab_content(self, slug):
        def deco(fn):
            _TAB[slug] = fn
            return fn
        return deco

    def on_page_content(self, slug):
        def deco(fn):
            _PAGE[slug] = fn
            return fn
        return deco

    def on_page_styles(self, fn):
        """Return CSS to inline into the viewer page's customStyles at request
        time — the same whole-UI core-theming slot as manifest `styles`. The
        host calls this for any plugin holding `ui.modify`; just define the
        handler (no manifest field, no slug). Return "" to contribute nothing.
        Output is appended after any static `styles` files. Used bare:
        `@plugin.on_page_styles`."""
        _PAGE_STYLES[0] = fn
        return fn

    def on_page_scripts(self, fn):
        """Return JavaScript to append to the viewer page's customJavascript —
        the dynamic counterpart to manifest `scripts`. The host wraps each
        plugin's script in a try/catch, but it runs in the shared viewer
        `window`: wrap your code in an IIFE and escape untrusted strings.
        Requires `ui.modify`. Used bare: `@plugin.on_page_scripts`."""
        _PAGE_SCRIPTS[0] = fn
        return fn

    def commands(self, table, *, prefix="!", case_sensitive=False, on_unknown=None):
        """Declare a chat-command table. The SDK wires the chat subscription for
        you — no @plugin.on_chat_message needed:

            plugin.commands({
                "uptime": {"description": "Stream uptime", "run": lambda ctx: ctx.reply("up!")},
            })

        `table` maps command name -> def (run/description/usage/aliases/
        mod_only/cooldown_ms/...); see define_commands. For advanced composition
        (e.g. dropping command messages from chat via a filter) use
        define_commands() directly inside your own handler instead."""
        router = define_commands({
            "prefix": prefix,
            "case_sensitive": case_sensitive,
            "commands": table,
            "on_unknown": on_unknown,
        })
        _COMMANDS_ROUTER[0] = router
        _install_chat_dispatch()
        return router


def _make_plugin():
    p = _Plugin()
    for name in _HANDLERS:
        setattr(p, name, p._register(name))
    return p


plugin = _make_plugin()


# ---------------------------------------------------------------------------
# Filter results.
# ---------------------------------------------------------------------------
class _Filter:
    def pass_(self):
        return {"action": "pass"}

    keep = pass_

    def drop(self, reason=""):
        return {"action": "drop", "reason": reason}

    def modify(self, payload):
        return {"action": "modify", "payload": payload}


filter = _Filter()


# ---------------------------------------------------------------------------
# onAuthCheck verdicts (auth.gate session re-validation on page load).
# ---------------------------------------------------------------------------
class _AuthCheck:
    def ok(self):
        return {"action": "ok"}

    def refresh(self, ttl=0):
        v = {"action": "refresh"}
        if ttl:
            v["ttl"] = int(ttl)
        return v

    def deny(self, reason=""):
        return {"action": "deny", "reason": reason}


auth_check = _AuthCheck()


# ---------------------------------------------------------------------------
# Chat command router (mirror of the JS SDK's defineCommands).
# ---------------------------------------------------------------------------
class CommandContext:
    """What a command's run() receives: the message, parsed args, and reply
    helpers. ``reply`` posts publicly; ``reply_privately`` whispers to the
    sender (falling back to a public post if their connection is unknown)."""

    def __init__(self, msg, command, args, arg_string):
        self.msg = msg
        self.user = msg.user if isinstance(msg, _Obj) else None
        self.command = command
        self.args = args
        self.arg_string = arg_string

    def reply(self, text):
        owncast.chat.send(text)

    def reply_privately(self, text):
        if not owncast.chat.reply_to(self.msg, text):
            owncast.chat.send(text)


def _ts_millis(msg):
    """Parse a chat message's ISO-8601 timestamp to epoch millis, or 0 when
    absent/unparseable — matching the JS router, which clocks cooldowns off
    msg.timestamp so they're deterministic in tests and free of sandbox-clock
    quirks."""
    ts = msg.timestamp if isinstance(msg, _Obj) else None
    if not ts:
        return 0
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return 0


def define_commands(config):
    """Build a chat-command router so plugins stop reimplementing prefix
    parsing, aliases, per-user cooldowns, and moderator gating. Returns a
    callable you feed a ChatMessage (from on_chat_message or
    filter_chat_message); it returns True when the message was a command (even
    if gated), False otherwise — so a filter can drop command messages:

        commands = define_commands({
            "prefix": "!",
            "commands": {
                "uptime": {"description": "Stream uptime", "run": lambda ctx: ctx.reply("up!")},
                "ban": {"mod_only": True, "cooldown_ms": 5000,
                        "run": lambda ctx: ctx.reply("bye " + (ctx.args[0] if ctx.args else ""))},
            },
        })

        @plugin.on_chat_message
        def _(msg):
            commands(msg)

    Each command def supports: run(ctx), aliases, mod_only, cooldown_ms,
    description, on_denied(ctx), on_cooldown(ctx). Top-level config supports:
    prefix (default "!"), case_sensitive (default False), commands, on_unknown,
    on_denied, on_cooldown.
    """
    config = config or {}
    prefix = config.get("prefix", "!")
    case_sensitive = bool(config.get("case_sensitive", False))
    norm = (lambda s: s) if case_sensitive else (lambda s: s.lower())

    # Resolve every name and alias to its canonical command definition, and
    # record metadata so the host can build a unified !help (see
    # _describe_commands). Metadata is reported via register(); it never
    # affects routing.
    table = {}
    defs = config.get("commands", {})
    for name, d in defs.items():
        table[norm(name)] = (name, d)
        for alias in d.get("aliases", []) or []:
            table[norm(alias)] = (name, d)
        _COMMAND_META.append({
            "name": name,
            "prefix": prefix,
            "description": d.get("description", "") or "",
            "usage": d.get("usage", "") or "",
            "aliases": d.get("aliases", []) or [],
            "modOnly": bool(d.get("mod_only", False)),
        })

    last_run = {}  # (command, user) -> epoch millis of last run

    def _maybe(fn, ctx):
        if callable(fn):
            fn(ctx)

    def handle(msg):
        body = (msg.body if isinstance(msg, _Obj) else "") or ""
        if not body.startswith(prefix):
            return False
        rest = body[len(prefix):]
        parts = rest.split()
        if not parts:
            return False
        called = parts[0]
        args = parts[1:]
        arg_string = rest[len(called):].strip()
        ctx = CommandContext(msg, norm(called), args, arg_string)

        entry = table.get(norm(called))
        if entry is None:
            _maybe(config.get("on_unknown"), ctx)
            return False
        name, d = entry
        ctx.command = name

        # Moderator gating: the sender's scopes must include MODERATOR.
        if d.get("mod_only"):
            scopes = (ctx.user.scopes if ctx.user else None) or []
            if "MODERATOR" not in scopes:
                _maybe(d.get("on_denied") or config.get("on_denied"), ctx)
                return True  # matched a command, but the caller wasn't allowed

        # Per-user cooldown, clocked off msg.timestamp.
        cooldown_ms = d.get("cooldown_ms", 0) or 0
        if cooldown_ms > 0:
            uid = (ctx.user.id if ctx.user else None)
            if uid is None:
                cid = msg.client_id if isinstance(msg, _Obj) else None
                uid = ("c%s" % cid) if cid is not None else "anon"
            key = "%s %s" % (name, uid)
            now = _ts_millis(msg)
            prev = last_run.get(key)
            if now and prev and now - prev < cooldown_ms:
                _maybe(d.get("on_cooldown") or config.get("on_cooldown"), ctx)
                return True
            if now:
                last_run[key] = now

        _maybe(d.get("run"), ctx)
        return True

    return handle


# ---------------------------------------------------------------------------
# owncast.* host facade.
# ---------------------------------------------------------------------------
class _Chat:
    def send(self, text):
        _host("owncast_send_chat")(str(text))

    def send_action(self, text):
        _host("owncast_send_chat_action")(str(text))

    def system(self, body):
        _host("owncast_send_chat_system")(str(body))

    def send_to(self, client_id, text):
        _host("owncast_send_chat_to")(int(client_id), str(text))

    def reply_to(self, msg, text):
        cid = msg.client_id if isinstance(msg, _Obj) else msg
        if cid is None:
            return False
        self.send_to(int(cid), text)
        return True

    def history(self, limit=0):
        return _wrap_list(_call_json("owncast_chat_history", int(limit)), ChatMessage)

    def clients(self):
        return _wrap_list(_call_json("owncast_chat_clients"))

    def delete_message(self, message_id):
        _host("owncast_delete_message")(str(message_id))

    def kick(self, client_id):
        _host("owncast_kick_client")(int(client_id))


class _KV:
    def get(self, key):
        val = _host("owncast_kv_get")(str(key))
        return val if val else None

    def set(self, key, value):
        _host("owncast_kv_set")(str(key), str(value))

    def get_json(self, key, fallback=None):
        raw = self.get(key)
        if raw is None:
            return fallback
        try:
            return json.loads(raw)
        except ValueError:
            return fallback

    def set_json(self, key, value):
        self.set(key, json.dumps(value))

    def delete(self, key):
        # The host has no kv-delete fn; clearing the value is the delete.
        self.set(key, "")


class _Storage:
    def upload(self, name, data):
        if isinstance(data, (bytes, bytearray)):
            data = data.decode("utf-8", "replace")
        return _call_json("owncast_storage_upload", str(name), str(data))


class _FS:
    def read_text(self, path):
        return _host("owncast_fs_read")(str(path)) or None

    read = read_text

    def write(self, path, data):
        if isinstance(data, (bytes, bytearray)):
            data = data.decode("utf-8", "replace")
        return _call_json("owncast_fs_write", str(path), str(data))

    def list(self, directory):
        return _call_json("owncast_fs_list", str(directory)) or []

    def delete(self, path):
        return _call_json("owncast_fs_delete", str(path))

    def exists(self, path):
        return bool(_host("owncast_fs_exists")(str(path)))


class _Events:
    def emit(self, event_type, payload):
        _host("owncast_emit_event")(str(event_type), json.dumps(payload))


class _Server:
    def info(self):
        return _wrap(_call_json("owncast_server_info"))

    def socials(self):
        return _wrap_list(_call_json("owncast_server_socials"))

    def emotes(self):
        return _wrap_list(_call_json("owncast_server_emotes"))

    def federation(self):
        return _wrap(_call_json("owncast_server_federation"))

    def tags(self):
        return _call_json("owncast_server_tags") or []


class _Stream:
    def current(self):
        return _wrap(_call_json("owncast_stream_current"))

    def broadcaster(self):
        return _wrap(_call_json("owncast_stream_broadcaster"))


class _VideoConfig:
    def read(self):
        return _wrap(_call_json("owncast_video_config_read"))

    def write(self, config):
        return _call_json("owncast_video_config_write", json.dumps(config))


class _Notifications:
    def discord(self, text):
        _host("owncast_notify_discord")(str(text))

    def browser_push(self, payload):
        body = payload if isinstance(payload, str) else json.dumps(payload)
        _host("owncast_notify_browser_push")(body)

    def fediverse(self, payload):
        _host("owncast_notify_fediverse")(json.dumps(payload))


class _Users:
    def list(self):
        return _wrap_list(_call_json("owncast_users_list"))

    def get(self, user_id):
        return _wrap(_call_json("owncast_user_get", str(user_id)))

    def set_enabled(self, user_id, enabled, reason=""):
        _host("owncast_user_set_enabled")(str(user_id), 1 if enabled else 0, str(reason))

    def ban_ip(self, ip):
        _host("owncast_ban_ip")(str(ip))

    def register(self, auth_id, display_name=None, scopes=None):
        """Find-or-create an authenticated user for an external identity.

        auth_id is the stable, provider-scoped id (e.g. "github:583231"); the
        host namespaces it by this plugin's slug so plugins can't collide on or
        spoof each other's users. Returns an object with .user_id. Raises on
        host error. Requires the 'users.register' permission.
        """
        req = {"authId": str(auth_id)}
        if display_name is not None:
            req["displayName"] = str(display_name)
        if scopes is not None:
            req["scopes"] = list(scopes)
        result = _call_json("owncast_users_register", json.dumps(req)) or {}
        if isinstance(result, dict) and result.get("error"):
            raise RuntimeError(result["error"])
        return _Obj(result)


class _Auth:
    """Viewer-authentication gate. Only a plugin holding 'auth.gate' (and enabled
    by an admin) can issue sessions, and only inside on_http_request, where the
    host attaches/clears the signed session cookie on the response."""

    def grant_session(self, user_id, ttl=0):
        """Issue a gate session for an already-registered user (see
        users.register). ttl is optional seconds (0 = host default). Raises on
        host error. Requires 'auth.gate'."""
        req = {"userId": str(user_id)}
        if ttl:
            req["ttl"] = int(ttl)
        result = _call_json("owncast_auth_grant_session", json.dumps(req)) or {}
        if isinstance(result, dict) and result.get("error"):
            raise RuntimeError(result["error"])

    def end_session(self):
        """Clear the current viewer's gate session (logout). The plugin still
        owns the response/redirect. Requires 'auth.gate'."""
        _host("owncast_auth_end_session")()


class _Fediverse:
    def post(self, text):
        return _call_json("owncast_fediverse_post", str(text))


class _SSE:
    def send(self, channel, event, data):
        body = data if isinstance(data, str) else json.dumps(data)
        _host("owncast_sse_send")(str(channel), str(event), body)


class _Actions:
    def add(self, actions):
        if isinstance(actions, dict):
            actions = [actions]
        _host("owncast_add_actions")(json.dumps(actions))

    def clear(self):
        _host("owncast_clear_actions")()


class _Timer:
    def set_timeout(self, fn, ms):
        return self._schedule(fn, ms, False)

    def set_interval(self, fn, ms):
        return self._schedule(fn, ms, True)

    def _schedule(self, fn, ms, repeat):
        tid = _next_timer[0]
        _next_timer[0] += 1
        ok = _host("owncast_timer_set")(int(tid), int(ms), 1 if repeat else 0)
        if not ok:
            return 0
        _TIMERS[tid] = (fn, repeat)
        return tid

    def clear(self, tid):
        _TIMERS.pop(int(tid), None)
        _host("owncast_timer_clear")(int(tid))


class _Config:
    def get(self, key, fallback=None):
        val = _call_json("owncast_config_get", str(key))
        return fallback if val is None else val


class _Assets:
    def read_text(self, path):
        return _host("owncast_asset_read")(str(path)) or None

    read = read_text


class _Http:
    """Outbound HTTP via Extism's built-in client (permission: network.fetch,
    with manifest network.allowedHosts). Not a host function."""

    def fetch(self, url, opts=None):
        opts = opts or {}
        resp = extism.Http.request(
            url,
            opts.get("method", "GET"),
            opts.get("body"),
            opts.get("headers") or {},
        )
        return _Obj({"status": resp.status_code, "body": resp.data_str()})


class _Owncast:
    http = _Http()
    chat = _Chat()
    kv = _KV()
    storage = _Storage()
    fs = _FS()
    events = _Events()
    server = _Server()
    stream = _Stream()
    video_config = _VideoConfig()
    notifications = _Notifications()
    users = _Users()
    auth = _Auth()
    fediverse = _Fediverse()
    sse = _SSE()
    actions = _Actions()
    timer = _Timer()
    config = _Config()
    assets = _Assets()


owncast = _Owncast()


# ---------------------------------------------------------------------------
# Dispatch — called by the build-generated wasm exports.
# ---------------------------------------------------------------------------
def _describe_commands():
    """Report the plugin's chat commands to the host for a unified !help.
    Empty when no commands are declared."""
    return _COMMAND_META


def _describe_subscriptions():
    subs = {}
    notify = [{"event": e} for e in _NOTIFY] + [{"event": e} for e in _CUSTOM]
    if notify:
        subs["notify"] = notify
    if _FILTER:
        subs["filter"] = [{"event": e} for e in _FILTER]
    return subs


def _dispatch_event(envelope):
    event = envelope.get("eventType")
    payload = envelope.get("payload")
    if event == "timer.fire":
        tid = (payload or {}).get("id")
        entry = _TIMERS.get(tid)
        if entry:
            fn, repeat = entry
            if not repeat:
                _TIMERS.pop(tid, None)
            fn()
        return
    entry = _NOTIFY.get(event)
    if entry is not None:
        fn, wrap = entry
        fn(wrap(payload))
        return
    custom = _CUSTOM.get(event)
    if custom is not None:
        custom(payload)


def _dispatch_filter(envelope):
    entry = _FILTER.get(envelope.get("eventType"))
    if entry is None:
        return {"action": "pass"}
    fn, wrap = entry
    result = fn(wrap(envelope.get("payload")))
    return result if isinstance(result, dict) else {"action": "pass"}


def _http_response(resp):
    if isinstance(resp, dict):
        return resp
    if resp is None:
        return {"status": 204}
    return {"status": 200, "body": str(resp)}


def _dispatch_http(request):
    method = (request.get("method") or "GET").upper()
    path = request.get("path") or "/"
    req = _Obj(request)
    path_matched = False
    for m, p, fn in _ROUTES:
        if p != path:
            continue
        path_matched = True
        if m == "*" or m == method:
            return _http_response(fn(req))
    # A registered path exists but no handler for this method.
    if path_matched:
        return {"status": 405, "body": "method not allowed"}
    if _HTTP[0] is not None:
        return _http_response(_HTTP[0](req))
    return {"status": 404, "body": "not found"}


def _dispatch_auth_check(request):
    # No handler → always ok (the hook is optional; a plugin that doesn't
    # implement it simply never revokes a session mid-stream).
    if _AUTH_CHECK[0] is None:
        return {"action": "ok"}
    return _AUTH_CHECK[0](_Obj(request)) or {"action": "ok"}


# A handler returning None (a bare `return`) contributes nothing, the same
# as returning "". `x or ""` maps None and other falsy values to "" before
# str(), so a handler never has to return an explicit empty string and a
# bare `return` can't inject the literal text "None" into the page. Mirrors
# the JS SDK's `handler() || ""`.
def _dispatch_tab_content(request):
    fn = _TAB.get((request or {}).get("slug"))
    return str(fn(_Obj(request)) or "") if fn else ""


def _dispatch_page_content(request):
    fn = _PAGE.get((request or {}).get("slug"))
    return str(fn(_Obj(request)) or "") if fn else ""


def _dispatch_page_styles():
    fn = _PAGE_STYLES[0]
    return str(fn() or "") if fn else ""


def _dispatch_page_scripts():
    fn = _PAGE_SCRIPTS[0]
    return str(fn() or "") if fn else ""
