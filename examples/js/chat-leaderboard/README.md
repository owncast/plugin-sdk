# chat-leaderboard

Counts how many messages each chatter has sent and ranks them, using the
plugin's own private SQLite database at
`data/plugin-storage/chat-leaderboard/db/`. `!top` shows the standings, `!rank`
shows the sender's own position, and a moderator can clear the board with
`!resetleaderboard`.

**Demonstrates:** the `storage.sql` permission end to end. `owncast.sql.exec`
for schema creation, an `ON CONFLICT` upsert, and a two-statement atomic batch;
`owncast.sql.query` for a bounded, database-sorted result set; and
`owncast.sql.queryRow` for a single row (returning `null` when nothing matches).

## Why SQL and not `storage.kv`

[message-counter](../message-counter/) keeps the same per-user counts in the
key-value store, and that is the right choice when you only ever read a value
back by its key. It cannot answer "who are the top five", because ranking means
sorting across every key, and the plugin would have to pull all of them into
memory to do it.

Here the database does the sorting and only the rows that will be shown cross
the host boundary. The trade is that you own a schema.

## What the host enforces

- **`exec` is one transaction.** A multi-statement batch commits whole or leaves
  the database untouched. The schema, and the reset that clears the standings
  while writing its audit row, both rely on this.
- **`query` never truncates silently.** A query that returns more than 10000
  rows, or more than 1 MiB of encoded results, fails and asks for a `LIMIT`.
  `!top` passes its bound as a parameter. Use `queryRow` when one row will do.
- **The database is private and capped.** 128 MiB, separate from the
  `storage.fs` quota. Plugins cannot reach each other's databases, and
  `ATTACH`, `PRAGMA`, temporary tables, and `load_extension` are all refused.
- **Not in Owncast's backups.** Treat the contents as rebuildable, or export
  what matters yourself.

## Run it

```sh
npm install
npm test     # build + run the scenarios in __tests__/
```

The test runner gives the plugin a real in-memory SQLite database, so the
scenarios exercise the actual SQL without a running Owncast. Each run starts
from an empty schema.

`npm run serve` drives chat too, but the dev server does not dispatch chat
commands yet, so `!top`, `!rank`, and `!resetleaderboard` only answer under
`npm test` or on a real Owncast instance. Plain messages still reach
`onChatMessage` and are counted:

```sh
curl -XPOST localhost:8080/_dev/chat -d '{"user":"alice","body":"hello"}'
```

## Permissions

- **storage.sql** for the private database.
- **chat.send** posts the bot's replies. The moderator gating on
  `!resetleaderboard` needs no extra permission.
