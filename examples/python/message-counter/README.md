# message-counter

Counts how many messages each user has sent, keyed on the stable user id. State survives host restarts because it's stored in this plugin's namespaced config.

**Demonstrates:** `owncast.kv.get(key)` / `owncast.kv.set(key, value)`, the `storage.kv` permission, per-plugin namespacing (plugins can't read each other's keys).
