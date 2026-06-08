# overlay plugin: ships a static HTML overlay (public/index.html) and a
# dynamic JSON API at /api/messages that reads recent chat history from
# Owncast. The page polls the API to render messages live.
import json

from owncast_plugin import plugin, owncast


@plugin.on_http_request
def handle(req):
    if req.method == "GET" and req.path == "/api/messages":
        messages = [m.raw for m in owncast.chat.history(20)]
        return {
            "status": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({"messages": messages}, separators=(",", ":")),
        }
    return {"status": 404, "body": "not found"}
