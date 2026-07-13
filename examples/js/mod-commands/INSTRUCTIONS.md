# Mod Commands

A bot showing a custom command prefix, an alias, a per-user cooldown, and a
moderator-only command.

## Commands

Enable the plugin in **Admin → Plugins**, then type these in chat. Note the `?`
prefix instead of the usual `!`.

| Command | Who can use it | What it does |
| --- | --- | --- |
| `?ping` (or `?p`) | anyone | The bot replies `pong`. `?PING` works too. Limited to once every 30 seconds per sender. |
| `?announce <message>` | moderators only | The bot posts `Announcement: <message>`. Non-moderator invocations are silent. |
| any other `?command` | anyone | No response. |

## Permissions

- **chat.send** posts the bot's replies.
