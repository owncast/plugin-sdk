# Announcer

A receiver-side demo. It listens for `relay.announcement.broadcast`, emitted by
the **relay** example plugin, and logs each one to the server. The event type is
plugin-defined, not a built-in Owncast event.

## How to use it

This plugin does nothing on its own. It's one half of a pair.

1. Install and enable **both** this plugin and the **relay** plugin.
2. In chat, type `/announce <text>` (that command is handled by relay).
3. relay emits `announcement.broadcast`. The host delivers it as
   `relay.announcement.broadcast`, this plugin receives it and writes an info
   entry to the Owncast server log through `owncast.log.info`.

There is no viewer-facing output. Watch the Owncast server logs to see it fire.

## Permissions

None. Receiving a custom event requires no permission. Only *emitting* one does (that's relay's `events.emit`).
