# Announcer

A receiver-side demo. It listens for a custom `announcement.broadcast` event that the **relay** example plugin emits, and logs each one to the server. The event type is a plugin-defined string, not a built-in Owncast event.

## How to use it

This plugin does nothing on its own. It's one half of a pair.

1. Install and enable **both** this plugin and the **relay** plugin.
2. In chat, type `/announce <text>` (that command is handled by relay).
3. relay emits an `announcement.broadcast` event. This plugin receives it and writes a line to the **server log** (stderr).

There is no viewer-facing output. Watch the Owncast server logs to see it fire.

## Permissions

None. Receiving a custom event requires no permission. Only *emitting* one does (that's relay's `events.emit`).
