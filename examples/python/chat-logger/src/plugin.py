from owncast_plugin import plugin


@plugin.on_chat_message
def log(msg):
    name = msg.user.display_name if msg.user else "?"
    print(f"{name}: {msg.body}")
