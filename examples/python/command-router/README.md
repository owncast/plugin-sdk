# Command Router

Uses the low-level `define_commands()` router directly, instead of the
declarative `plugin.commands()` table from the `mod-commands` example.
`define_commands()` returns the router as a plain function you wire yourself,
which lets you express a few things the table shorthand can't:

- **Case-sensitive matching.** `case_sensitive=True` means `!SHOUT` does not run
  `!shout`.
- **Per-user cooldowns.** `cooldown_ms` rate-limits a command per sender, and
  `on_cooldown` replies when someone is too quick.
- **Private replies.** `ctx.reply_privately()` whispers to the sender and falls
  back to a public post when their connection isn't known.
- **Dropping commands from chat.** The router returns `True` when a message was
  a command, so wiring it inside `filter_chat_message` lets recognized commands
  be handled and removed from public chat while everything else passes through.

Each command's metadata is still reported to the host for the unified `!help`,
exactly as with the declarative table.

## Chat commands

| Command | What it does |
| --- | --- |
| `!shout <message>` | Posts the message in all caps, then disappears from chat. Limited to once every 30 seconds per person. |
| `!secret` | Whispers "The cake is a lie." privately to the sender (public fallback if the connection is unknown). |

## Run it

```bash
owncast-plugin-py test        # build + run the tests
owncast-plugin-py serve       # build + serve a dev instance
```

```bash
# against `owncast-plugin-py serve`
curl -XPOST localhost:8080/_dev/chat -d '{"user":"alice","body":"!shout hello"}'
```

## Permissions

- **chat.send** posts the replies.
- **chat.filter** is required because the plugin subscribes to
  `filter_chat_message` to drop command messages from chat.
