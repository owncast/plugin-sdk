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

__all__ = ["plugin", "owncast", "filter", "auth_check", "CommandContext"]

_EVENT_CHAT_COMMAND = "chat.command"
_EVENT_TIMER_FIRE = "timer.fire"
_DEFAULT_COMMAND_PREFIX = "!"

# Host function table, populated by the build-injected import block (only the
# host functions the manifest's permissions grant, plus the ambient ones).
_HOST = {}


def _host(name):
    fn = _HOST.get(name)
    if fn is None:
        raise RuntimeError(
            "owncast: host function '%s' is unavailable. Declare the "
            "permission it needs in plugin.manifest.json." % name
        )
    return fn


def _call_json(name, *args):
    """Call a host fn that returns a JSON (or empty) string, then decode it."""
    raw = _host(name)(*args)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return raw


# ---------------------------------------------------------------------------
# Wire payloads: attribute views over the host's JSON (snake_case accessors map
# to camelCase wire keys, and `.raw` exposes the underlying dict).
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
    "on_fediverse": ("fediverse.activity", "notify", _Obj),
    "on_fediverse_follow": ("fediverse.follow", "notify", _Obj),
    "on_fediverse_like": ("fediverse.like", "notify", _Obj),
    "on_fediverse_repost": ("fediverse.repost", "notify", _Obj),
    "on_fediverse_quote": ("fediverse.quote", "notify", _Obj),
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
_FILTER_PRIORITY = [100]  # filter-chain priority for this plugin (lower runs earlier); default matches the JS SDK

# Command declarations reported to the host and their local handlers. Core
# matches chat messages and delivers chat.command directly to this plugin.
_COMMAND_META = []
_COMMAND_HANDLERS = {}

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
            (_FILTER if kind == "filter" else _NOTIFY)[event] = (fn, wrap)
            return fn

        return deco

    def on(self, event_type):
        def deco(fn):
            _CUSTOM[event_type] = fn
            return fn
        return deco

    def set_filter_priority(self, priority):
        """Set this plugin's filter-chain priority (lower runs earlier). Applies
        to every filter handler the plugin defines. Defaults to 100, matching
        the JS SDK's definePlugin({filterPriority})."""
        _FILTER_PRIORITY[0] = int(priority)

    def on_http_request(self, arg=None, *, methods=None):
        """HTTP handler. Three forms:
          @plugin.on_http_request              : catch-all (req.path/req.method parsed by you)
          @plugin.on_http_request("/api/x")    : only requests to that exact path (any method)
          @plugin.on_http_request("/api/x", methods=["GET","POST"])  : path + methods
        Routes are matched before the catch-all. The path is relative to the
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
        `req.user`, and you return auth_check.ok() / refresh() / deny(). Optional:
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
        time, the same whole-UI core-theming slot as manifest `styles`. The
        host calls this for any plugin holding `ui.modify`, so just define the
        handler (no manifest field, no slug). Return "" to contribute nothing.
        Output is appended after any static `styles` files. Used bare:
        `@plugin.on_page_styles`."""
        _PAGE_STYLES[0] = fn
        return fn

    def on_page_scripts(self, fn):
        """Return JavaScript to append to the viewer page's customJavascript,
        the dynamic counterpart to manifest `scripts`. The host wraps each
        plugin's script in a try/catch, but it runs in the shared viewer
        `window`: wrap your code in an IIFE and escape untrusted strings.
        Requires `ui.modify`. Used bare: `@plugin.on_page_scripts`."""
        _PAGE_SCRIPTS[0] = fn
        return fn

    def commands(self, table, *, prefix=_DEFAULT_COMMAND_PREFIX, case_sensitive=False):
        """Declare chat commands."""
        if not isinstance(table, dict):
            raise TypeError("commands table must be a dict")
        if not isinstance(prefix, str) or not prefix:
            raise TypeError("command prefix must be a non-empty string")
        for name, command in table.items():
            if not isinstance(command, dict):
                raise TypeError(f'command "{name}" must be a dict')
            aliases = command.get("aliases")
            if aliases is None:
                aliases = []
            if not isinstance(aliases, list) or not all(
                isinstance(alias, str) for alias in aliases
            ):
                raise TypeError(
                    f'command "{name}" aliases must be a list of strings'
                )
            cooldown_ms = command.get("cooldown_ms")
            if cooldown_ms is None:
                cooldown_ms = 0
            if (
                isinstance(cooldown_ms, bool)
                or not isinstance(cooldown_ms, int)
                or cooldown_ms < 0
            ):
                raise TypeError(
                    f'command "{name}" cooldown_ms must be a non-negative integer'
                )
            _COMMAND_HANDLERS[name] = command
            _COMMAND_META.append({
                "name": name,
                "prefix": prefix,
                "description": command.get("description", "") or "",
                "usage": command.get("usage", "") or "",
                "aliases": aliases,
                "modOnly": bool(command.get("mod_only", False)),
                "caseSensitive": bool(case_sensitive),
                "cooldownMs": cooldown_ms,
            })
        return table


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


# Chat commands.
class CommandContext:
    """What a command's run() receives."""

    def __init__(self, msg, command, invoked_as, args, arg_string):
        self.msg = msg
        self.user = msg.user if isinstance(msg, _Obj) else None
        self.command = command
        self.invoked_as = invoked_as
        self.args = args
        self.arg_string = arg_string

    def reply(self, text):
        owncast.chat.send(text)

    def reply_privately(self, text):
        if not owncast.chat.reply_to(self.msg, text):
            owncast.chat.send(text)


def _dispatch_command(event):
    if not isinstance(event, dict):
        return
    command_name = event.get("command")
    command = _COMMAND_HANDLERS.get(command_name)
    if not command:
        return
    run = command.get("run")
    if not callable(run):
        return
    msg = ChatMessage(event.get("message") or {})
    run(CommandContext(
        msg,
        event.get("command"),
        event.get("invokedAs") or command_name,
        event.get("args") or [],
        event.get("argString") or "",
    ))


def _as_bytes(data):
    if isinstance(data, bytes):
        return data
    if isinstance(data, bytearray):
        return bytes(data)
    return str(data).encode("utf-8")


# ---------------------------------------------------------------------------
# owncast.* host facade.
# ---------------------------------------------------------------------------
class _Log:
    def _write(self, name, message):
        fn = _HOST.get(name)
        if fn is None:
            raise RuntimeError("owncast.log is unavailable in this host")
        fn(str(message))

    def info(self, message):
        self._write("owncast_log_info", message)

    def warning(self, message):
        self._write("owncast_log_warning", message)

    def error(self, message):
        self._write("owncast_log_error", message)


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
        _require_operation_result(
            "owncast_delete_message", "chat.delete_message failed", str(message_id)
        )

    def kick(self, client_id):
        _require_operation_result(
            "owncast_kick_client", "chat.kick failed", int(client_id)
        )


class _KV:
    def get(self, key):
        val = _host("owncast_kv_get")(str(key))
        return val if val else None

    def set(self, key, value):
        _require_operation_result(
            "owncast_kv_set", "kv.set failed", str(key), str(value)
        )

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
        # The host has no kv-delete fn, so clearing the value is the delete.
        self.set(key, "")


class _Storage:
    def upload(self, name, data):
        """Upload raw bytes, or UTF-8 encode a string convenience value."""
        return _call_json("owncast_storage_upload", str(name), _as_bytes(data))


def _operation_result(name, failure_message, *args):
    result = _call_json(name, *args)
    return result if isinstance(result, dict) else {"error": failure_message}

def _require_operation_result(name, failure_message, *args):
    result = _operation_result(name, failure_message, *args)
    if "error" in result:
        raise RuntimeError(result.get("error") or failure_message)
    return result


class _FS:
    def read(self, path):
        """Read raw file bytes."""
        return _host("owncast_fs_read")(str(path))

    def read_text(self, path):
        """Read a file as UTF-8 text, replacing malformed byte sequences."""
        data = self.read(path)
        return data.decode("utf-8", "replace") if data is not None else None

    def write(self, path, data):
        """Write raw bytes, or UTF-8 encode a string convenience value."""
        return _call_json("owncast_fs_write", str(path), _as_bytes(data))

    def list(self, directory):
        return _call_json("owncast_fs_list", str(directory)) or []

    def delete(self, path):
        return _operation_result("owncast_fs_delete", "delete failed", str(path))

    def exists(self, path):
        return bool(_host("owncast_fs_exists")(str(path)))


class _SQL:
    """Private SQLite database, one per plugin (permission: storage.sql). It
    lives in db/ next to the storage.fs sandbox in files/, outside anything
    owncast.fs.* can name, and has its own quota.
    A result without an error field is successful. An error, missing response,
    or non-dict response raises RuntimeError. Integral parameters bind as SQLite
    INTEGERs exactly, including values past 2**53."""

    def _request(self, sql, params, max_rows=0):
        request = {"sql": str(sql), "params": list(params or [])}
        # max_rows is not an author parameter: query_row uses it to ask the
        # host for a single row.
        if max_rows:
            request["maxRows"] = int(max_rows)
        return json.dumps(request)

    def _result(self, name, sql, params, max_rows=0):
        result = _operation_result(
            name, "SQL host call failed", self._request(sql, params, max_rows)
        )
        if "error" in result:
            raise RuntimeError(result.get("error") or "SQL host call failed")
        return result

    def _rows(self, result):
        columns = result.get("columns")
        rows = result.get("rows")
        if not isinstance(columns, list) or not isinstance(rows, list):
            raise RuntimeError("SQL host returned an invalid result")
        if any(not isinstance(row, list) for row in rows):
            raise RuntimeError("SQL host returned an invalid result")
        return [dict(zip(columns, row)) for row in rows]

    def exec(self, sql, params=None):
        """Run one statement batch as a single transaction, committed whole or
        not at all, and return its result dict. Raises RuntimeError on error.
        A call has 2 seconds to finish."""
        return self._result("owncast_sql_exec", sql, params)

    def query(self, sql, params=None):
        """Return matching rows as dicts keyed by column name. The result is
        never silently shortened: over 10000 rows, or over 1 MiB of encoded
        data, raises RuntimeError asking for a LIMIT."""
        return self._rows(self._result("owncast_sql_query", sql, params))

    def query_row(self, sql, params=None):
        """Return the first matching row as a dict, or None. Only that row is
        read back, so this works on a table query() is too big for."""
        rows = self._rows(self._result("owncast_sql_query", sql, params, 1))
        return rows[0] if rows else None


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
        """Apply a partial config update. Raise RuntimeError when the host
        rejects the update or does not return an operation result."""
        result = _operation_result(
            "owncast_video_config_write",
            "video_config.write failed",
            json.dumps(config),
        )
        if "error" in result:
            raise RuntimeError(result.get("error") or "video_config.write failed")


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
        _require_operation_result(
            "owncast_user_set_enabled",
            "users.set_enabled failed",
            str(user_id),
            1 if enabled else 0,
            str(reason),
        )

    def ban_ip(self, ip):
        _require_operation_result(
            "owncast_ban_ip", "users.ban_ip failed", str(ip)
        )

    def register(
        self,
        auth_id,
        display_name=None,
        scopes=None,
        profile_url=None,
        handle=None,
        public=None,
    ):
        """Find or create an authenticated user for an external identity.

        auth_id is the stable, provider-scoped ID. Omit display_name or pass
        None to have Owncast generate one. profile_url and handle describe a
        verified external profile. Set public=True only when the viewer agreed
        to show that identity publicly. Returns an object with .user_id. Raises
        on host error. Requires 'users.register'.
        """
        req = {"authId": str(auth_id)}
        if display_name is not None:
            req["displayName"] = str(display_name)
        if scopes is not None:
            req["scopes"] = list(scopes)
        if profile_url is not None:
            req["profileUrl"] = str(profile_url)
        if handle is not None:
            req["handle"] = str(handle)
        if public is not None:
            req["public"] = bool(public)
        return _Obj(
            _require_operation_result(
                "owncast_users_register", "users.register failed", json.dumps(req)
            )
        )


class _Auth:
    """Viewer-authentication gate. Only a plugin holding 'auth.gate' (and enabled
    by an admin) can issue sessions, and only inside on_http_request, where the
    host attaches/clears the signed session cookie on the response. The admin
    selects the cumulative, host-owned access mode. Plugins cannot read or
    change it."""

    def grant_session(self, user_id, ttl=0):
        """Issue a gate session for an already-registered user (see
        users.register). ttl is optional seconds (0 = host default). Raises on
        host error. Requires 'auth.gate'."""
        req = {"userId": str(user_id)}
        if ttl:
            req["ttl"] = int(ttl)
        _require_operation_result(
            "owncast_auth_grant_session", "auth.grant_session failed", json.dumps(req)
        )

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
        _require_operation_result(
            "owncast_add_actions",
            "owncast.actions.add failed",
            json.dumps(actions),
        )

    def clear(self):
        _require_operation_result(
            "owncast_clear_actions", "owncast.actions.clear failed"
        )


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
    def read(self, path):
        """Read raw bundled asset bytes."""
        return _host("owncast_asset_read")(str(path))

    def read_text(self, path):
        """Read a bundled asset as UTF-8 text, replacing malformed bytes."""
        data = self.read(path)
        return data.decode("utf-8", "replace") if data is not None else None


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
        # Surface response headers to match the JS SDK and the documented
        # {status, headers, body} shape. The extism PDK exposes headers as a
        # method, so call it when callable, and read defensively so the SDK
        # still works on a runtime that shapes them differently.
        raw_headers = getattr(resp, "headers", None)
        if callable(raw_headers):
            try:
                raw_headers = raw_headers()
            except Exception:
                raw_headers = None
        try:
            headers = dict(raw_headers) if raw_headers else {}
        except (TypeError, ValueError):
            headers = {}
        return _Obj({
            "status": resp.status_code,
            "headers": headers,
            "body": resp.data_str(),
        })


class _Owncast:
    http = _Http()
    log = _Log()
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
    sql = _SQL()


owncast = _Owncast()


# ---------------------------------------------------------------------------
# Dispatch: called by the build-generated wasm exports.
# ---------------------------------------------------------------------------
def _describe_commands():
    """Report command registrations to the host for matching and dispatch."""
    return _COMMAND_META


def _describe_subscriptions():
    subs = {}
    notify = [{"event": e} for e in _NOTIFY] + [{"event": e} for e in _CUSTOM]
    if notify:
        subs["notify"] = notify
    if _FILTER:
        subs["filter"] = [{"event": e, "priority": _FILTER_PRIORITY[0]} for e in _FILTER]
    return subs


def _dispatch_event(envelope):
    event = envelope.get("eventType")
    payload = envelope.get("payload")
    if event == _EVENT_TIMER_FIRE:
        tid = (payload or {}).get("id")
        entry = _TIMERS.get(tid)
        if entry:
            fn, repeat = entry
            if not repeat:
                _TIMERS.pop(tid, None)
            fn()
        return
    if event == _EVENT_CHAT_COMMAND:
        _dispatch_command(payload)
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
    # No handler → always ok (the hook is optional, and a plugin that doesn't
    # implement it never revokes a session mid-stream).
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
