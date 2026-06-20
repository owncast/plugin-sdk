# page-content-demo: demonstrates dynamic extraPageContent and viewer tabs.
#
# on_page_content — called by the host to render the "banner" slot.
#   Renders greeting.mustache, personalised with the viewer's display name.
#
# on_tab_content — called by the host to render the "stream-info" tab.
#   Renders info.mustache with live stream, server, tags, socials, and
#   federation data read via server.read.
#
# The JS version uses the `mustache` npm package; this Python port keeps a small
# Mustache-subset renderer in mini_mustache.py and imports it.
from owncast_plugin import plugin, owncast
from mini_mustache import render

_TEMPLATES = {}


def _tpl(name):
    if name not in _TEMPLATES:
        _TEMPLATES[name] = owncast.assets.read_text(name)
    return _TEMPLATES[name]


@plugin.on_page_content("banner")
def banner(req):
    user = req.user
    display_name = (user.display_name if user else None) or "visitor"
    return render(_tpl("greeting.mustache"), {"displayName": display_name})


@plugin.on_tab_content("stream-info")
def stream_info(req):
    stream = owncast.stream.current()
    server = owncast.server.info()
    tags = owncast.server.tags()
    socials = owncast.server.socials()
    federation = owncast.server.federation()
    return render(
        _tpl("info.mustache"),
        {
            "stream": stream.raw if stream else {},
            "server": server.raw if server else {},
            "tags": tags,
            "hasTags": len(tags) > 0,
            "socials": [s.raw if hasattr(s, "raw") else s for s in socials],
            "hasSocials": len(socials) > 0,
            "federation": federation.raw if federation else {},
        },
    )
