# announcer

Declares the local custom hook `announcement.broadcast`, registered by the host as `announcer.announcement.broadcast`, and logs events sent to it by `../relay`.

**Demonstrates:** custom-event hook ownership via the `on: { ... }` object in `definePlugin` and info-level server logging through `owncast.log.info`. Neither owning the hook nor writing the log requires a permission.
