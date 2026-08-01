# chat-logger

Logs every chat message through Owncast's server log. Messages that start with `warning:` or `error:` use the matching level. Other messages use info. No permission is required.

**Demonstrates:** the `onChatMessage` notification handler, `owncast.log.info/warning/error`, and a public host capability available with an empty permissions list.
