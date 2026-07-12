# Mod Commands

Demonstrates a declarative command table:

- **A custom prefix.** `commandPrefix: "?"` makes the bot answer `?ping` instead
  of the default `!ping`.
- **Aliases.** `aliases: ["p"]` lets `?p` run the same command as `?ping`.
- **Case-insensitive matching.** Names match case-insensitively by default, so
  `?PING` reaches `ping` too.
- **A per-user cooldown.** `cooldownMs: 30000` allows one `?ping` response per
  sender every 30 seconds.
- **A moderator-only command.** `modOnly: true` limits the command to
  moderators. Other invocations are silent.
- **Composition with `onChatMessage`.** A regular chat handler still receives
  command messages independently, here posting a system audit line.

Command declarations support argument parsing, moderator gating, and cooldowns.
Unknown commands are silent. Descriptions and usage appear in the built-in
`!help`. Plugins may still receive and respond to `!help` as ordinary chat.

## Chat commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `?ping` (or `?p`) | anyone | Replies `pong`. |
| `?announce <message>` | moderators | Posts `Announcement: <message>`. Non-moderator invocations are silent. |
| any other `?command` | anyone | No response. |

## Run it

```bash
npm install
npm test        # build + run the tests
npm run serve   # build + serve a dev instance
```

The test tooling drives chat directly, including the sender's moderator scopes,
so you can exercise the gating without a running Owncast:

```bash
# against `npm run serve`
curl -XPOST localhost:8080/_dev/chat -d '{"user":"alice","body":"?ping"}'
```

## Permissions

- **chat.send** posts the replies. The moderator gating needs no extra permission.
