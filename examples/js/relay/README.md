# relay

When a chat message starts with `/announce `, emits a custom `announcement.broadcast` event carrying the announcement body, user, and timestamp. Other plugins (see `../announcer`) can subscribe.

**Demonstrates:** plugin → plugin communication via `owncast.events.emit(type, payload)`, the `events.emit` permission. Pairs with `announcer/` to show one full custom-event round-trip.
