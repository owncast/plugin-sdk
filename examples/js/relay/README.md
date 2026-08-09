# relay

When a chat message starts with `/announce `, sends the announcement body, user, and timestamp to the `announcer.announcement.broadcast` custom hook owned by `../announcer`.

**Demonstrates:** targeting another plugin's fully qualified hook with `owncast.events.emit(type, payload)` and the `events.emit` permission.
