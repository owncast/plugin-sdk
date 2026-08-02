# engagement-bot: pipes Owncast events out to the streamer's other
# channels (Discord, browser push, fediverse). Exercises
# notifications.send (Discord + browser push), fediverse.post (the
# stream-start announcement), and chat.moderate (delete_message for the
# inline spam filter).
from owncast_plugin import plugin, owncast

SPAM_KEYWORDS = ["buy crypto", "free money", "click here"]


@plugin.on_chat_message
def on_chat_message(msg):
    body = msg.body.lower()
    if any(k in body for k in SPAM_KEYWORDS):
        owncast.chat.delete_message(msg.id)


# When a stream starts, post to both Discord (subscribers' DMs) and to
# the fediverse (the streamer's public follower base).
@plugin.on_stream_started
def on_stream_started(info):
    title = info.title or "live now"
    owncast.notifications.discord(f"Stream live: {title}")
    owncast.fediverse.post(f"🔴 Going live: {title}")


# When someone follows the account on the fediverse, send a browser push
# to subscribed clients.
@plugin.on_fediverse_follow
def on_fediverse_follow(event):
    owncast.notifications.browser_push({
        "title": "New follower",
        "body": f"{event.actor.handle} just followed",
        "url": event.actor.url,
    })


@plugin.on_fediverse_like
def on_fediverse_like(event):
    owncast.notifications.discord(
        f"like from {event.actor.handle}: {event.target.url}"
    )


@plugin.on_fediverse_repost
def on_fediverse_repost(event):
    owncast.notifications.discord(
        f"repost from {event.actor.handle}: {event.target.url}"
    )


@plugin.on_fediverse_quote
def on_fediverse_quote(event):
    caption = event.content_text or "quoted your post"
    owncast.notifications.discord(
        f"quote from {event.actor.handle}: {caption}\n{event.url}"
    )


@plugin.on_fediverse
def on_fediverse(activity):
    owncast.notifications.discord(
        f"activity {activity.type}: {activity.actor} -> {activity.object}"
    )


def _snippet(text):
    text = text or ""
    return text[:200] + "…" if len(text) > 200 else text


# Mentions and replies carry content, so echo a short summary to Discord
# so the streamer sees off-platform engagement in their normal channel.
@plugin.on_fediverse_mention
def on_fediverse_mention(post):
    snippet = _snippet(post.content_text)
    owncast.notifications.discord(
        f"mention from {post.actor.handle}: {snippet}\n{post.url}"
    )


@plugin.on_fediverse_reply
def on_fediverse_reply(post):
    snippet = _snippet(post.content_text)
    owncast.notifications.discord(
        f"reply from {post.actor.handle}: {snippet}\n{post.url}"
    )
