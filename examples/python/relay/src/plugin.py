from owncast_plugin import plugin, owncast

ANNOUNCEMENT_BROADCAST = "announcement.broadcast"


@plugin.on_chat_message
def relay(msg):
    prefix = "/announce "
    if not (msg.body or "").startswith(prefix):
        return
    owncast.events.emit(
        ANNOUNCEMENT_BROADCAST,
        {
            "text": msg.body[len(prefix):],
            "by": msg.user.display_name if msg.user else None,
            "at": msg.timestamp,
        },
    )
