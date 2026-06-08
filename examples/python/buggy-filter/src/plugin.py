# Always throws, exists to verify the host's fail-open behavior in the
# filter chain. A real plugin should never look like this.
from owncast_plugin import plugin


@plugin.filter_chat_message
def boom(msg):
    raise Exception("intentional failure for fail-open testing")
