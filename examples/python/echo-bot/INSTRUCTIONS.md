# Echo Bot

A chat bot that replies to **every** message with `"<user> said: <message>"`, posting under its own bot identity ("Example Echo").

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Post anything in chat.
3. The bot replies immediately — type `hello` and it posts `alice said: hello`.

The bot replies to every human message but ignores its own, so it won't loop. Because it echoes *everything*, it's noisy by design — it's a minimal demo of posting to chat, not something to run on a live stream.

## Permissions

- **chat.send** — lets the plugin post messages under the bot identity Owncast provisions for it automatically.
