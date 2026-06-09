# Stream Tracker

Tracks stream lifecycle and chat activity, and answers status commands in chat. It also posts a short announcement when the stream starts or its title changes.

## Commands

Enable the plugin in **Admin → Plugins**, then type these in chat:

| Command | What it does |
| --- | --- |
| `!uptime` | How long the stream has been live. |
| `!who` | Who's currently present in chat. |
| `!server` | Basic server info (name, version). |

It also posts "/me"-style action announcements automatically when the stream goes live or the title changes. The chat roster and stream-start time are persisted, so they survive a restart.

## Permissions

- **chat.send** — posts command answers and announcements.
- **storage.kv** — persists the chat roster and stream-start time.
- **server.read** — reads server info for `!server` and stream details.
