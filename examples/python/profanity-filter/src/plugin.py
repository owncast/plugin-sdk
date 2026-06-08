import re

from owncast_plugin import plugin, filter

WORDLIST = ["damn", "hell", "crap"]


@plugin.filter_chat_message
def redact(msg):
    body = msg.body
    modified = False
    for word in WORDLIST:
        pattern = re.compile(r"\b" + word + r"\b", re.IGNORECASE)
        if pattern.search(body):
            body = pattern.sub("*" * len(word), body)
            modified = True
    if modified:
        updated = dict(msg.raw)
        updated["body"] = body
        return filter.modify(updated)
    return filter.pass_()
