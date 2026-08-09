# Announcement Relay

Watches chat for an `/announce <text>` command and sends a custom event to the **announcer** example's `announcer.announcement.broadcast` hook.

## How to use it

1. Install and enable this plugin (and **announcer**, if you want to see the event received).
2. In chat, type `/announce Doors open at 8pm`.
3. relay emits `announcer.announcement.broadcast` with the text, user, and timestamp. The **announcer** plugin receives it. Watch the server log to see the round trip.

This is a plugin-to-plugin communication demo. On its own it has no viewer-facing output.

## Permissions

- **events.emit**: required to *emit* a custom event. (Subscribing to one, as announcer does, needs no permission.)
