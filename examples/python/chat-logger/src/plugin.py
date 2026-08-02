from owncast_plugin import owncast, plugin


@plugin.on_chat_message
def log(msg):
    line = f"{msg.user.display_name if msg.user else '?'}: {msg.body}"
    if msg.body.startswith("error:"):
        owncast.log.error(line)
    elif msg.body.startswith("warning:"):
        owncast.log.warning(line)
    else:
        owncast.log.info(line)
