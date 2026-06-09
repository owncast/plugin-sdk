# profanity-filter

Replaces flagged words in chat messages with asterisks, then lets the (modified) message continue through the filter chain and out to notifications.

**Demonstrates:** the `@plugin.filter_chat_message` handler, returning `filter.modify(payload)` to mutate a message without dropping it (vs `filter.pass_()` to leave it untouched), the difference between filters (sequential, can rewrite) and notifications (parallel, read-only).
