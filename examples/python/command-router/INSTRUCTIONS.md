# Command Router

A bot showing the lower-level command router: case-sensitive commands, per-user
cooldowns, private replies, and removing command messages from chat.

## Commands

Enable the plugin in **Admin → Plugins**, then type these in chat. The command
message itself disappears from public chat once the bot handles it.

| Command | What it does |
| --- | --- |
| `!shout <message>` | The bot reposts your message in all caps. You can only shout once every 30 seconds. Sooner than that and the bot tells you to wait. Note the lowercase `!shout` is required. |
| `!secret` | The bot whispers a secret back to you privately. If it can't reach you privately it posts publicly instead. |

## Permissions

- **chat.send** posts the bot's replies.
- **chat.filter** lets the bot drop command messages from chat.
