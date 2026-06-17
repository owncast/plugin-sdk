# Mod Commands

Demonstrates the declarative command table:

- **A custom prefix.** `prefix="?"` makes the bot answer `?ping` instead of the
  default `!ping`.
- **Aliases.** `"aliases": ["p"]` lets `?p` run the same command as `?ping`.
- **Case-insensitive matching.** Names match case-insensitively by default, so
  `?PING` reaches `ping` too.
- **A moderator-only command.** `mod_only: True` tells the host to run the command
  only when the sender is a moderator. Everyone else is routed to `on_denied`.
- **An unknown-command fallback.** `on_unknown` catches a `?`-prefixed message
  that matches no command in the table.
- **Composition with `@plugin.on_chat_message`.** A plain handler runs alongside
  the table (the router runs first, then your handler), here posting a system
  audit line for each command.

Moderator gating uses the sender identity the host attaches to each message, so
it is reliable and never trusts a display name. Each command's metadata (name,
description, usage, aliases) is reported to the host so it can build a unified
`!help` across all installed plugins.

For the lower-level router, per-user cooldowns, private replies, and dropping
command messages from chat with a filter, see the `command-router` example.

## Chat commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `?ping` (or `?p`) | anyone | Replies `pong`. |
| `?announce <message>` | moderators | Posts `Announcement: <message>`. Non-moderators get a polite refusal. |
| any other `?command` | anyone | Routed to `on_unknown`, which suggests `?ping`. |

## Run it

```bash
owncast-plugin-py test        # build + run the tests
owncast-plugin-py serve       # build + serve a dev instance
```

The test tooling drives chat directly, including the sender's moderator scopes,
so you can exercise the gating without a running Owncast:

```bash
# against `owncast-plugin-py serve`
curl -XPOST localhost:8080/_dev/chat -d '{"user":"alice","body":"?ping"}'
```

## Permissions

- **chat.send** posts the replies. The moderator gating needs no extra permission.
