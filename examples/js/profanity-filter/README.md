# profanity-filter

Replaces flagged words in chat messages with asterisks, then lets the (modified) message continue through the filter chain and out to notifications.

**Demonstrates:** the `filterChatMessage` handler, returning `filter.modify(payload)` to mutate a chat message without dropping it, the difference between filters (sequential, can rewrite) and notifications (parallel, read-only).
