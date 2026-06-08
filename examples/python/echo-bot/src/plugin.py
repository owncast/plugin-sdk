from owncast_plugin import plugin, owncast


@plugin.on_chat_message
def greet(msg):
    name = msg.user.display_name if msg.user else "someone"
    owncast.chat.send(f"{name} said: {msg.body}")
