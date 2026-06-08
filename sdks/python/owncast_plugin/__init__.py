"""Owncast plugin SDK for Python.

Author a plugin by importing this module, registering handlers with the
``plugin`` decorators, calling the host through ``owncast``, and returning
``filter`` results from filter handlers:

    from owncast_plugin import plugin, owncast, filter

    @plugin.on_chat_message
    def greet(msg):
        owncast.chat.send(f"hi {msg.user.display_name}")

At build time the build tool inlines this runtime together with your code and
the manifest's permitted host-function imports into a single module, then
compiles it to WebAssembly with `extism-py` (which is single-file only, so the
SDK can't be a separately-imported module inside the wasm). This file is also
importable on your dev machine for editor support and unit tests.
"""

# `extism` only exists inside the compiled wasm. Guard the import so this
# module is importable on a dev machine (editor support / unit tests) too.
try:
    import extism  # type: ignore
except ImportError:  # pragma: no cover - dev machine, not wasm
    extism = None

import json

__all__ = ["plugin", "owncast", "filter"]

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
_ROUTES = []    # list of (method_or_"*", path, fn) for path/method routing
_TAB = {}       # slug -> fn
_PAGE = {}      # slug -> fn


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


def _dispatch_tab_content(request):
    fn = _TAB.get((request or {}).get("slug"))
    return str(fn(_Obj(request))) if fn else ""


def _dispatch_page_content(request):
    fn = _PAGE.get((request or {}).get("slug"))
    return str(fn(_Obj(request))) if fn else ""
