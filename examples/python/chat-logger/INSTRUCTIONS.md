# Chat Logger

Writes a line to the Owncast **server log** for every chat message. A read-only example that needs no permissions.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Have someone post in chat.
3. Each message shows up in the server's standard-error output, prefixed with `[chat-logger]`.

There is nothing to configure and no viewer-facing output — this is purely a server-side log. It's a good starting point for an analytics or archival plugin.

## Permissions

None. A plugin can observe chat events through the message handler without declaring any permission; permissions are only required to *act* (send, moderate, and so on).
