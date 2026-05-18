# chat-logger

Logs every chat message to stderr with a `[chat-logger]` prefix. No permissions required — read-only via the event payload.

**Demonstrates:** the `onChatMessage` notification handler, `console.log` debugging, the zero-permissions case (a plugin can react to events without declaring anything).
