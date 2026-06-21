# ip-bot: responds to !ip in chat by fetching the server's public IP
# from api.ipify.org (network.fetch + manifest network.allowedHosts).
#
# A single, fixed command, so this example parses msg.body by hand to show
# that's perfectly fine. For multiple commands, aliases, cooldowns, or
# moderator gating, declare a plugin.commands({...}) table instead (see the
# stream-ops / stream-tracker / timer-bot examples).
import json

from owncast_plugin import plugin, owncast


@plugin.on_chat_message
def on_chat_message(msg):
    if msg.body.strip() != "!ip":
        return
    res = owncast.http.fetch("https://api.ipify.org?format=json")
    if res.status != 200:
        owncast.chat.send(f"couldn't fetch IP (status {res.status})")
        return
    ip = json.loads(res.body).get("ip")
    owncast.chat.send(f"server IP: {ip}")
