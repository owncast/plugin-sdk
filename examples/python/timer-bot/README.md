# timer-bot

Demonstrates the two ways an Owncast plugin does time-based work, driven from
chat. There is no `setTimeout` in the plugin sandbox, so:

- **`owncast.timer`** asks the host to run a callback later: `set_timeout` (once),
  `set_interval` (repeating), and `clear(id)` to cancel. Active only while
  scheduled.
- **`on_tick`** fires once a second, for open-ended periodic work.

Neither needs a permission. (Timers are in-memory: they don't survive a plugin
reload or a host restart.)

## Chat commands

| Command | What it does | Mechanism |
| --- | --- | --- |
| `!remind <seconds> <message>` | Sends `message` back to you after the delay | `set_timeout` |
| `!every <seconds> <message>` | Repeats `message` until `!stop` | `set_interval` |
| `!countdown <seconds>` | Counts down live, one number a second | `on_tick` |
| `!stop` | Cancels the repeater and any pending reminder | `clear` |

```python
@plugin.on_chat_message
def on_chat_message(msg):
    # !remind 30 stretch  ->  in 30s: "@you reminder: stretch"
    _state["reminder_id"] = owncast.timer.set_timeout(
        lambda: say(f"@{who} reminder: {message}"),
        seconds * 1000,
    )

@plugin.on_tick
def on_tick(ev):
    # counts down a number a second when armed by !countdown
    if _state["countdown"] > 0:
        say(str(_state["countdown"]))
        _state["countdown"] -= 1
```

## Run it

```bash
owncast-plugin-py test  examples/python/timer-bot     # build + run the tests
owncast-plugin-py serve examples/python/timer-bot     # build + serve a dev instance
```

The dev tooling can drive chat and the tick directly, so you can exercise every
command without a running Owncast:

```bash
# in another terminal, against `serve`
curl -XPOST localhost:8080/_dev/chat  -d '{"user":"alice","body":"!countdown 5"}'
curl -XPOST localhost:8080/_dev/event -d '{"type":"tick","payload":{"now":0}}'
```

In a real Owncast install the tick fires on its own once a second, and timers
fire on their own schedule.
