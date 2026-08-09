from owncast_plugin import owncast, plugin


@plugin.on("relay.announcement.broadcast")
def handle(payload):
    by = payload.get("by") if isinstance(payload, dict) else None
    text = payload.get("text") if isinstance(payload, dict) else None
    owncast.log.info(f"Announcement from {by}: {text}")
