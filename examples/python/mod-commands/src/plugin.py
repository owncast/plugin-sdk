from owncast_plugin import plugin, owncast

PING_COOLDOWN_MS = 30_000

# Demonstrates the declarative command table:
#   - a custom prefix ("?" here instead of the default "!"), set with the
#     prefix keyword,
#   - aliases (an alternate name that invokes the same command),
#   - a moderator-only command.
#
# Command names match case-insensitively by default, so "?PING" reaches ping.
# The bot needs only chat.send. Moderator access uses the sender's scopes, not
# their display name.


# Open to anyone. Proves the custom prefix is wired up. "p" is an alias, so
# "?p" runs ping too.
def _ping(ctx):
    ctx.reply("pong")


# Moderators only (see mod_only below). Runs only for a moderator.
def _announce(ctx):
    message = " ".join(ctx.args)
    ctx.reply(
        f"Announcement: {message}"
        if message
        else "Usage: ?announce <message>"
    )


# A regular chat handler remains independent from command dispatch.
@plugin.on_chat_message
def _audit(msg):
    if msg.body and msg.body.startswith("?"):
        owncast.chat.system(f"(command: {msg.body})")


plugin.commands({
    "ping": {
        "description": "Check the bot is alive",
        "aliases": ["p"],
        "cooldown_ms": PING_COOLDOWN_MS,
        "run": _ping,
    },
    "announce": {
        "description": "Post an announcement (moderators only)",
        "usage": "?announce <message>",
        "mod_only": True,
        "run": _announce,
    },
}, prefix="?")
