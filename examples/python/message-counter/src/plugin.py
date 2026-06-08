from owncast_plugin import plugin, owncast


@plugin.on_chat_message
def count(msg):
    # Key per-user state on the stable user id, not the display name (which
    # can change); show the display name in the message.
    user = msg.user
    uid = user.id if user else "anon"
    name = user.display_name if user else "someone"
    key = f"count:{uid}"
    nxt = int(owncast.kv.get(key) or "0") + 1
    owncast.kv.set(key, str(nxt))
    owncast.chat.send(f"{name} has sent {nxt} message(s) total")
