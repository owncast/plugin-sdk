# Slow Mode

A chat filter that enforces a minimum gap between consecutive messages from the same user. If someone posts again less than **2 seconds** after their previous message, the new message is dropped.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Post two messages in quick succession from the same account — the second is silently dropped (it never reaches chat) until 2 seconds have elapsed.

The interval is fixed at 2 seconds in this example, and the per-user timing is held in memory. It demonstrates *dropping* a message outright — contrast with `profanity-filter`, which rewrites messages instead.

## Permissions

- **chat.filter** — lets the plugin reject messages in the chat filter pipeline.
