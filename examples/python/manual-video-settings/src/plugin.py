# manual-video-settings: admin form that drives owncast.video_config.
# All editing is done through host-gated /admin/* routes, so the plugin
# itself doesn't have to check auth; the host rejects unauthenticated
# requests before they reach on_http_request.
#
#   GET  /admin/             , admin form (public/admin/index.html)
#   GET  /admin/api/config   , current VideoConfig (videoconfig.read)
#   POST /admin/api/config   , apply a VideoConfigUpdate (videoconfig.write)
import json

from owncast_plugin import plugin, owncast


def parse_variant(v):
    return {
        "width": int(v.get("width") or 0),
        "height": int(v.get("height") or 0),
        "framerate": int(v.get("framerate") or 0),
        "videoBitrate": int(v.get("videoBitrate") or 0),
        "audioBitrate": int(v.get("audioBitrate") or 0),
        "isPassthrough": bool(v.get("isPassthrough")),
    }


@plugin.get("/admin/api/config")
def get_config(req):
    config = owncast.video_config.read()
    return {
        "status": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(config.raw, separators=(",", ":")),
    }


@plugin.post("/admin/api/config")
def set_config(req):
    try:
        parsed = json.loads(req.body)
    except ValueError:
        return {"status": 400, "body": "invalid JSON"}

    # Build a partial VideoConfigUpdate: omit fields the form didn't
    # touch so unrelated knobs are left alone by the host.
    update = {}
    if parsed.get("latencyLevel") is not None:
        update["latencyLevel"] = int(parsed["latencyLevel"])
    codec = parsed.get("codec")
    if isinstance(codec, str) and len(codec) > 0:
        update["codec"] = codec
    if isinstance(parsed.get("variants"), list):
        update["variants"] = [parse_variant(v) for v in parsed["variants"]]

    try:
        owncast.video_config.write(update)
    except Exception as e:  # noqa: BLE001
        return {"status": 400, "body": str(e)}
    return {"status": 204}
