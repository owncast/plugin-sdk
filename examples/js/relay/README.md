# relay

When a chat message starts with `/announce `, emits a custom
`announcement.broadcast` event carrying the announcement body, user, and
timestamp. The host delivers it as `relay.announcement.broadcast`, which other
plugins (see `../announcer`) can subscribe to.

**Demonstrates:** plugin → plugin communication via `owncast.events.emit(type, payload)`, the `events.emit` permission. Pairs with `announcer/` to show one full custom-event round-trip.
