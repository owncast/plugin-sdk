# Mod Commands

A small bot showing a custom command prefix, an alias, and a moderator-only
command.

## Commands

Enable the plugin in **Admin → Plugins**, then type these in chat. Note the `?`
prefix instead of the usual `!`.

| Command | Who can use it | What it does |
| --- | --- | --- |
| `?ping` (or `?p`) | anyone | The bot replies `pong`. `?PING` works too. |
| `?announce <message>` | moderators only | The bot posts `Announcement: <message>`. A non-moderator who tries it gets told it is moderators only. |
| any other `?command` | anyone | The bot replies that the command is unknown and suggests `?ping`. |

## Permissions

- **chat.send** posts the bot's replies.
