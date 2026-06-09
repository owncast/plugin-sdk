# buggy-filter

Always raises an error from `@plugin.filter_chat_message`. Exists only to verify the host's fail-open behavior — when a filter errors, the chain continues with the unmodified payload rather than dropping the message.

**Demonstrates:** fail-open semantics in the filter chain; the strike system (a plugin whose filter raises repeatedly is eventually auto-disabled for the session). A real plugin should never look like this.
