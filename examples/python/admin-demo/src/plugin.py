# admin-demo, shows manifest-declared admin pages. The /admin/* routes
# are auth-gated by the host; the plugin doesn't have to check anything.
#
# Layout:
#   GET  /                    , public landing page (public/index.html)
#   GET  /admin/              , admin-only settings panel (public/admin/index.html)
#   GET  /admin/api/settings  , admin-only JSON config read
#   POST /admin/api/settings  , admin-only JSON config write
import json

from owncast_plugin import plugin, owncast


def settings():
    raw = owncast.kv.get("settings") or "{}"
    try:
        return json.loads(raw)
    except ValueError:
        return {}


@plugin.on_http_request
def handle(req):
    if req.method == "GET" and req.path == "/admin/api/settings":
        return {
            "status": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps(settings(), separators=(",", ":")),
        }
    if req.method == "POST" and req.path == "/admin/api/settings":
        try:
            parsed = json.loads(req.body)
        except ValueError:
            return {"status": 400, "body": "invalid JSON"}
        owncast.kv.set("settings", json.dumps(parsed, separators=(",", ":")))
        return {"status": 204}
    return {"status": 404}
