from owncast_plugin import plugin, owncast

# A chat bot that shows the two ways a plugin does time-based work. The wasm
# sandbox has no setTimeout, so:
#   - owncast.timer.set_timeout / set_interval / clear schedule callbacks the
#     host runs later (only active while scheduled), and
#   - on_tick fires once a second for open-ended periodic work.
#
# Commands are declared with plugin.commands(...) (the SDK wires the chat
# subscription, so there's no on_chat_message). State lives in the long-lived instance, so
# it persists between calls. Our own replies don't start with "!", so the router
# never reacts to them.
_state = {"reminder_id": None, "interval_id": None, "countdown": 0}


def say(text):
    owncast.chat.send(text)


def _parse_int(s):
    """Mimic JS parseInt(s, 10): leading integer, else None (falsy)."""
    if s is None:
        return None
    s = s.strip()
    i = 0
    if i < len(s) and s[i] in "+-":
        i += 1
    j = i
    while j < len(s) and s[j].isdigit():
        j += 1
    if j == i:
        return None
    return int(s[:j])


# !remind <seconds> <message>: send the message once, later (set_timeout).
def _remind(ctx):
    seconds = _parse_int(ctx.args[0]) if ctx.args else None
    message = " ".join(ctx.args[1:])
    if not seconds or not message:
        say("Usage: !remind <seconds> <message>")
        return
    who = ctx.msg.user.display_name if ctx.msg.user else "you"
    _state["reminder_id"] = owncast.timer.set_timeout(
        lambda: say(f"@{who} reminder: {message}"),
        seconds * 1000,
    )
    say(f"Reminder set: {seconds}s")


# !every <seconds> <message>: repeat until !stop (set_interval). One at a time.
def _every(ctx):
    seconds = _parse_int(ctx.args[0]) if ctx.args else None
    message = " ".join(ctx.args[1:])
    if not seconds or not message:
        say("Usage: !every <seconds> <message>")
        return
    if _state["interval_id"] is not None:
        owncast.timer.clear(_state["interval_id"])
    _state["interval_id"] = owncast.timer.set_interval(
        lambda: say(message), seconds * 1000
    )
    say(f"Repeating every {seconds}s (send !stop to end)")


# !countdown <seconds>: count down live, one number a second, via on_tick.
def _countdown(ctx):
    seconds = _parse_int(ctx.args[0]) if ctx.args else None
    if not seconds:
        say("Usage: !countdown <seconds>")
        return
    _state["countdown"] = seconds
    say(f"Counting down from {seconds}")


# !stop: cancel the repeater, any pending reminder, and the countdown.
def _stop(ctx):
    if _state["interval_id"] is not None:
        owncast.timer.clear(_state["interval_id"])
        _state["interval_id"] = None
    if _state["reminder_id"] is not None:
        owncast.timer.clear(_state["reminder_id"])
        _state["reminder_id"] = None
    _state["countdown"] = 0
    say("Stopped")


plugin.commands({
    "remind": {
        "description": "Remind you with a message after N seconds",
        "usage": "!remind <seconds> <message>",
        "run": _remind,
    },
    "every": {
        "description": "Repeat a message every N seconds until !stop",
        "usage": "!every <seconds> <message>",
        "run": _every,
    },
    "countdown": {
        "description": "Count down live from N seconds (driven by on_tick)",
        "usage": "!countdown <seconds>",
        "run": _countdown,
    },
    "stop": {
        "description": "Cancel the repeater, pending reminder, and countdown",
        "run": _stop,
    },
})


# Fires once a second while the plugin is enabled. Drives the live countdown
# and does nothing the rest of the time. `now` is the host wall-clock time in ms.
@plugin.on_tick
def on_tick(ev):
    if _state["countdown"] <= 0:
        return
    say(str(_state["countdown"]))
    _state["countdown"] -= 1
    if _state["countdown"] == 0:
        say("Go!")
