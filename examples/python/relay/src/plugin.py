# One command with a custom "/" prefix and a free-text argument, parsed by hand
# to show manual parsing is fine. A plugin.commands({...}) table (used by
# stream-ops / stream-tracker / timer-bot) also supports a custom prefix if you
# outgrow this.
from owncast_plugin import plugin, owncast

ANNOUNCEMENT_BROADCAST = "announcer.announcement.broadcast"


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
