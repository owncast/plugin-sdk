from owncast_plugin import plugin, filter, define_commands

# The low-level command router. The mod-commands example uses the declarative
# plugin.commands() table. This one calls define_commands() directly, which
# hands back the router as a plain function you wire yourself. That lets you do
# things the table shorthand can't, shown here:
#
#   - case-sensitive matching (case_sensitive=True), so "!Shout" is NOT "!shout"
#   - per-user cooldowns with an on_cooldown fallback
#   - private replies (reply_privately), which whisper to the sender and fall
#     back to a public post when their connection isn't known
#
# The router returns True when a message was a command (even if gated or on
# cooldown), False otherwise. We use that return value inside filter_chat_message
# to drop recognized commands from public chat while letting everything else
# pass through untouched.


def _shout(ctx):
    ctx.reply(f"📢 {ctx.arg_string.upper()}")


def _shout_cooldown(ctx):
    ctx.reply("Easy there, you can only shout every 30 seconds.")


def _secret(ctx):
    ctx.reply_privately("The cake is a lie.")


_commands = define_commands({
    "case_sensitive": True,
    "commands": {
        "shout": {
            "description": "Repeat a message in all caps (once every 30s)",
            "usage": "!shout <message>",
            "cooldown_ms": 30000,
            "run": _shout,
            "on_cooldown": _shout_cooldown,
        },
        "secret": {
            "description": "Whisper a secret only the sender can see",
            "run": _secret,
        },
    },
})


# chat.filter is required to subscribe to filter_chat_message. Recognized
# commands are dropped so they never show up in public chat. Anything that
# isn't a command passes through unchanged.
@plugin.filter_chat_message
def _route(msg):
    return filter.drop("handled as a command") if _commands(msg) else filter.pass_()
