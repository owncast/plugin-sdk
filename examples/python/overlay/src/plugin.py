# overlay plugin: serves recent chat history and streams the complete
# viewer-visible chat, including bot/system/action messages, to its static
# HTML overlay through the host-owned Server-Sent Events endpoint.
import json

from owncast_plugin import plugin, owncast


@plugin.on_chat_message_broadcast
def stream_message(message):
    owncast.sse.send("overlay", "chat", message.raw)


@plugin.get("/api/messages")
def messages(req):
    msgs = [m.raw for m in owncast.chat.history(20)]
    return {
        "status": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"messages": msgs}, separators=(",", ":")),
    }
