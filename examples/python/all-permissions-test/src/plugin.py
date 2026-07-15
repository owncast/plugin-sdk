# all-permissions-test: a build/load canary, not a real plugin. It declares
# every permission the host offers and registers a no-op handler for every
# subscription, so the install-time load check (owncast-plugin-test, which CI
# builds from owncast@develop) fails the moment the host adds, renames, or
# re-gates a permission or subscription.
#
# When the host's permission catalog changes, update this plugin's manifest,
# its JavaScript twin, and the permission table in docs/PLUGIN_AUTHOR_GUIDE.md
# together.
from owncast_plugin import plugin, filter, auth_check

# Declarative command registration (host-matched dispatch).
plugin.commands({
    "noop": {
        "description": "Does nothing (canary)",
        "run": lambda ctx: None,
    },
})


@plugin.on_chat_message
def on_chat_message(_msg):
    pass


# Requires chat.filter.
@plugin.filter_chat_message
def filter_chat_message(_msg):
    return filter.pass_()


@plugin.on_chat_user_joined
def on_chat_user_joined(_user):
    pass


@plugin.on_chat_user_parted
def on_chat_user_parted(_user):
    pass


@plugin.on_chat_user_renamed
def on_chat_user_renamed(_change):
    pass


@plugin.on_message_moderated
def on_message_moderated(_event):
    pass


@plugin.on_stream_started
def on_stream_started(_info):
    pass


@plugin.on_stream_stopped
def on_stream_stopped(_info):
    pass


@plugin.on_stream_title_changed
def on_stream_title_changed(_change):
    pass


# Require http.sse.
@plugin.on_sse_connect
def on_sse_connect(_event):
    pass


@plugin.on_sse_disconnect
def on_sse_disconnect(_event):
    pass


@plugin.on_tick
def on_tick(_event):
    pass


# The seven fediverse handlers require fediverse.inbound.
@plugin.on_fediverse
def on_fediverse(_activity):
    pass


@plugin.on_fediverse_follow
def on_fediverse_follow(_event):
    pass


@plugin.on_fediverse_like
def on_fediverse_like(_event):
    pass


@plugin.on_fediverse_repost
def on_fediverse_repost(_event):
    pass


@plugin.on_fediverse_quote
def on_fediverse_quote(_event):
    pass


@plugin.on_fediverse_mention
def on_fediverse_mention(_post):
    pass


@plugin.on_fediverse_reply
def on_fediverse_reply(_post):
    pass


# Requires http.serve.
@plugin.on_http_request
def on_http_request(_req):
    return {"status": 204}


# Requires auth.gate.
@plugin.on_auth_check
def on_auth_check(_req):
    return auth_check.ok()


# Require ui.modify.
@plugin.on_page_styles
def on_page_styles():
    return ""


@plugin.on_page_scripts
def on_page_scripts():
    return ""


# Custom plugin-to-plugin event subscription.
@plugin.on("all-permissions-test.noop")
def on_noop(_payload):
    pass
