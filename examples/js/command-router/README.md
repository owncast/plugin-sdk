# Command Router

Uses the low-level `defineCommands()` router directly, instead of the
declarative `commands` table from the `mod-commands` example. `defineCommands()`
returns the router as a plain function you wire yourself, which unlocks a few
things the table shorthand can't express:

- **Case-sensitive matching.** `caseSensitive: true` means `!SHOUT` does not run
  `!shout`.
- **Per-user cooldowns.** `cooldownMs` rate-limits a command per sender, and
  `onCooldown` replies when someone is too quick.
- **Private replies.** `ctx.replyPrivately()` whispers to the sender and falls
  back to a public post when their connection isn't known.
- **Dropping commands from chat.** The router returns `true` when a message was
  a command, so wiring it inside `filterChatMessage` lets recognized commands be
  handled and removed from public chat while everything else passes through.

Each command's metadata is still reported to the host for the unified `!help`,
exactly as with the declarative table.

## Chat commands

| Command | What it does |
| --- | --- |
| `!shout <message>` | Posts the message in all caps, then disappears from chat. Limited to once every 30 seconds per person. |
| `!secret` | Whispers "The cake is a lie." privately to the sender (public fallback if the connection is unknown). |

## Run it

```bash
npm install
npm test        # build + run the tests
npm run serve   # build + serve a dev instance
```

```bash
# against `npm run serve`
curl -XPOST localhost:8080/_dev/chat -d '{"user":"alice","body":"!shout hello"}'
```

## Permissions

- **chat.send** posts the replies.
- **chat.filter** is required because the plugin subscribes to
  `filterChatMessage` to drop command messages from chat.
