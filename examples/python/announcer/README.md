# announcer

Subscribes to `relay.announcement.broadcast`, the custom event emitted by
`../relay`, and logs it. It is a plugin-defined event, not a built-in Owncast
event. The host adds the `relay.` prefix, so that is the name to subscribe to.

**Demonstrates:** custom-event subscription via the
`@plugin.on("relay.announcement.broadcast")` decorator and info-level server
logging through `owncast.log.info`. Neither receiving the event nor writing the
log requires a permission.
