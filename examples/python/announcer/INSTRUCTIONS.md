# Announcer

A receiver-side demo. It declares the local custom hook `announcement.broadcast`. The host registers it as `announcer.announcement.broadcast`, which the **relay** example targets.

## How to use it

This plugin does nothing on its own. It's one half of a pair.

1. Install and enable **both** this plugin and the **relay** plugin.
2. In chat, type `/announce <text>` (that command is handled by relay).
3. relay emits `announcer.announcement.broadcast`. The host routes it to this plugin's local `announcement.broadcast` handler, which writes an info entry through `owncast.log.info`.

There is no viewer-facing output. Watch the Owncast server logs to see it fire.

## Permissions

None. Declaring a custom hook requires no permission. Only emitting to one does (that's relay's `events.emit`).
