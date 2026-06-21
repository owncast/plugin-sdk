from owncast_plugin import plugin, owncast

# Demonstrates the declarative command table:
#   - a custom prefix ("?" here instead of the default "!"), set with the
#     prefix keyword,
#   - aliases (an alternate name that invokes the same command),
#   - a moderator-only command (the host checks the sender's scopes before
#     running a mod_only command, everyone else is routed to on_denied), and
#   - on_unknown, the fallback for a prefixed message that matches no command
#     in the table.
#
# Command names match case-insensitively by default, so "?PING" reaches ping.
# The bot needs only chat.send. Moderator gating is enforced by the host from
# the sender identity on the message, so the plugin never trusts a display name.


# Open to anyone. Proves the custom prefix is wired up. "p" is an alias, so
# "?p" runs ping too.
def _ping(ctx):
    ctx.reply("pong")


# Moderators only (see mod_only below). Runs only for a moderator.
def _announce(ctx):
    message = " ".join(ctx.args)
    ctx.reply(f"Announcement: {message}" if message else "Usage: ?announce <message>")


# A non-moderator who types ?announce lands here.
def _denied(ctx):
    ctx.reply("Only moderators can use ?announce.")


# Fires when a "?"-prefixed message names a command not in the table.
def _unknown(ctx):
    ctx.reply(f'Unknown command "?{ctx.command}". Try ?ping.')


# You can use @plugin.on_chat_message alongside plugin.commands(). The command
# router runs first, then this runs for every message, so both run. Here it
# posts a system audit line whenever someone uses a "?" command.
@plugin.on_chat_message
def _audit(msg):
    if msg.body and msg.body.startswith("?"):
        owncast.chat.system(f"(command: {msg.body})")


plugin.commands({
    "ping": {
        "description": "Check the bot is alive",
        "aliases": ["p"],
        "run": _ping,
    },
    "announce": {
        "description": "Post an announcement (moderators only)",
        "usage": "?announce <message>",
        "mod_only": True,
        "run": _announce,
        "on_denied": _denied,
    },
}, prefix="?", on_unknown=_unknown)
