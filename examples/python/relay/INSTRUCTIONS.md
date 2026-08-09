# Announcement Relay

Watches chat for an `/announce <text>` command and re-broadcasts it as a custom
`announcement.broadcast` event, delivered to subscribers as
`relay.announcement.broadcast`. Pairs with the **announcer** example.

## How to use it

1. Install and enable this plugin (and **announcer**, if you want to see the event received).
2. In chat, type `/announce Doors open at 8pm`.
3. relay emits `announcement.broadcast` carrying the text, the user, and a
   timestamp. The host delivers `relay.announcement.broadcast` to the
   **announcer** plugin, or any plugin that subscribes. Watch the server log to
   see the round-trip.

This is a plugin-to-plugin communication demo. On its own it has no viewer-facing output.

## Permissions

- **events.emit**: required to *emit* a custom event. (Subscribing to one, as announcer does, needs no permission.)
