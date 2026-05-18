# slow-mode

Enforces a minimum interval (2 seconds) between consecutive messages from the same user. Tracks the last-message timestamp per user in KV and drops messages that arrive too soon.

**Demonstrates:** `filter.drop(reason)` to reject a message before it reaches notifications or other plugins, KV-backed filter state, the difference between `filter.modify` (rewrite) and `filter.drop` (reject).
