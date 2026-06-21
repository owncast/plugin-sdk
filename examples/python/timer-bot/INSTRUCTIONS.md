# Timer Bot

A chat bot that demonstrates time-based actions. Plugins can't use a raw `setTimeout`, so the host provides scheduled timers and a once-a-second tick. This bot drives both from chat commands.

## Commands

Enable the plugin in **Admin → Plugins**, then type these in chat:

| Command | What it does |
| --- | --- |
| `!remind <seconds> <message>` | After the delay, the bot replies to you with your message. e.g. `!remind 30 stretch` → 30s later: `@you reminder: stretch`. |
| `!every <seconds> <message>` | Repeats the message on that interval until you send `!stop`. e.g. `!every 60 hydrate`. |
| `!countdown <seconds>` | Counts down live in chat, one number per second, then posts `Go!`. e.g. `!countdown 5`. |
| `!stop` | Cancels the repeater and any pending reminder or countdown. |

The bot posts a confirmation when you set a timer, and shows a usage hint if the arguments are missing.

## Notes

Timers are in-memory: they do **not** survive a plugin reload or a server restart. `!every` runs one repeater at a time, so starting a new one replaces the old.

## Permissions

- **chat.send**: posts reminders, countdowns, and confirmations.
