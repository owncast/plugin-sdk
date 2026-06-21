# chat-logger

Logs every chat message to stderr with the poster's name. No permissions required: read-only via the event payload.

**Demonstrates:** the `@plugin.on_chat_message` notification handler, `print()` debugging (host stderr), the zero-permissions case (a plugin can react to events without declaring anything).
