# fediverse-chat-bridge: when someone mentions or replies to the streamer
# on the fediverse, surface it in chat as a system message that includes
# the poster's avatar, display name, handle (linked to their profile),
# and the post text (linked to the original).
import re

from owncast_plugin import plugin, owncast


# Anything coming from a remote fediverse server is untrusted text; the
# system-message body is rendered as HTML, so escape everything that lands
# in attribute values or text nodes before inserting it.
def escape_html(s):
    s = "" if s is None else str(s)
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


# Only allow http(s) URLs through unescaped, defense against javascript:
# and data: URLs sneaking into href/src attributes.
def safe_url(u):
    s = "" if u is None else str(u)
    return s if re.match(r"^https?://", s, re.IGNORECASE) else ""


def render_post(post):
    actor = post.actor if post.actor else None

    def actor_get(*keys):
        if actor is None:
            return None
        for k in keys:
            v = getattr(actor, k, None)
            if v is not None:
                return v
        return None

    avatar = safe_url(actor_get("image"))
    profile = safe_url(actor_get("url"))
    permalink = safe_url(post.url)
    name = escape_html(actor_get("name") or actor_get("handle") or "Someone")
    handle = escape_html(actor_get("handle") or "")
    text = escape_html(post.content_text or "")

    avatar_html = (
        '<img src="%s" alt="" width="32" height="32" '
        'style="vertical-align:middle;border-radius:50%%;margin-right:8px">'
        % escape_html(avatar)
        if avatar
        else ""
    )
    name_html = (
        '<a href="%s" rel="noopener noreferrer">%s</a>' % (escape_html(profile), name)
        if profile
        else name
    )
    handle_html = (' <span style="opacity:0.7">%s</span>' % handle) if handle else ""
    text_html = (
        ', <a href="%s" rel="noopener noreferrer">%s</a>'
        % (escape_html(permalink), text)
        if permalink
        else ", %s" % text
    )

    return "%s<strong>%s</strong>%s%s" % (avatar_html, name_html, handle_html, text_html)


@plugin.on_fediverse_mention
def on_fediverse_mention(post):
    owncast.chat.system(render_post(post))


@plugin.on_fediverse_reply
def on_fediverse_reply(post):
    owncast.chat.system(render_post(post))
