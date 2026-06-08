from owncast_plugin import plugin


@plugin.on("announcement.broadcast")
def handle(payload):
    by = payload.get("by") if isinstance(payload, dict) else None
    text = payload.get("text") if isinstance(payload, dict) else None
    print(f"ANNOUNCEMENT from {by}: {text}")
