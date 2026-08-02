# Example Chat Leaderboard

Keeps a running count of how many messages each chatter has sent and posts the
standings in chat on request.

Counting starts as soon as you enable the plugin. Messages that begin with `!`
are not counted, so asking for the leaderboard does not raise your own score.
Chatters are tracked by their account, not their name, so someone who renames
keeps their history and shows up under their new name.

## Commands

Enable the plugin in **Admin → Plugins**, then type these in chat.

| Command | Who can use it | What it does |
| --- | --- | --- |
| `!top` | anyone | Posts the five most active chatters with their message counts. Says `No messages counted yet.` on an empty board. |
| `!rank` | anyone | Posts the sender's own position and message count, or tells them they have not been counted yet. |
| `!resetleaderboard` | moderators only | Clears the standings and records that a reset happened. Non-moderator invocations are silent. |

## Where the data lives

The counts are kept in a small database that belongs to this plugin alone, on
your server under `data/plugin-storage/chat-leaderboard/db/`. Nothing else can
read it, and it is not served over the web.

Two things worth knowing before you rely on it:

- It is **not** included in Owncast's database backups. If the standings matter
  to you, copy that directory yourself.
- Uninstalling the plugin leaves the data in place, so reinstalling picks the
  standings back up. To start clean, delete that directory while the plugin is
  disabled.

## Permissions

- **storage.sql** gives the plugin its own private database for the counts.
- **chat.send** lets the bot post the standings.
