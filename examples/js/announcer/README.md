# announcer

Subscribes to the custom `announcement.broadcast` event emitted by `../relay` and logs it. The event type is a plugin-defined string, not a built-in Owncast event.

**Demonstrates:** custom-event subscription via the `on: { ... }` object in `definePlugin`. No `events.emit` permission needed — that's only required to *emit*, not to receive.
