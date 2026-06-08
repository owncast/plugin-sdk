import json

from owncast_plugin import plugin

# This plugin does no identity work of its own. Owncast resolves the chat
# user from the request (via the chat identity cookie) and hands it to the
# handler as the optional `req.user`. We just reflect it back so a viewer can
# see, end to end, that their chat identity reached the plugin.


@plugin.on_http_request
def on_http_request(req):
    if req.method == "GET" and req.path == "/api/me":
        if not req.user:
            # No chat identity on this request: the visitor hasn't registered /
            # connected to chat, or the cookie didn't reach us. req.user is
            # optional precisely because of this case.
            return {
                "status": 401,
                "headers": {"content-type": "application/json"},
                "body": json.dumps(
                    {
                        "identified": False,
                        "message": (
                            "No chat identity on this request. "
                            "Join the chat, then reload."
                        ),
                    },
                    separators=(",", ":"),
                ),
            }

        return {
            "status": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps(
                {"identified": True, "user": req.user.raw},
                separators=(",", ":"),
            ),
        }

    return {"status": 404, "body": "not found"}
