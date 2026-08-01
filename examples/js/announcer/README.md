# announcer

Subscribes to the custom `announcement.broadcast` event emitted by `../relay` and logs it. The event type is a plugin-defined string, not a built-in Owncast event.

**Demonstrates:** custom-event subscription via the `on: { ... }` object in `definePlugin` and info-level server logging through `owncast.log.info`. Neither receiving the event nor writing the log requires a permission.
