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


@plugin.get("/admin/api/settings")
def get_settings(req):
    return {
        "status": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(settings(), separators=(",", ":")),
    }


@plugin.post("/admin/api/settings")
def set_settings(req):
    try:
        parsed = json.loads(req.body)
    except ValueError:
        return {"status": 400, "body": "invalid JSON"}
    owncast.kv.set("settings", json.dumps(parsed, separators=(",", ":")))
    return {"status": 204}
