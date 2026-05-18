# buggy-filter

Always throws an error from `filterChatMessage`. Exists only to verify the host's fail-open behavior — when a filter errors, the chain continues with the unmodified payload rather than dropping the message.

**Demonstrates:** fail-open semantics in the filter chain; the strike system (a plugin whose filter throws repeatedly is eventually auto-disabled for the session). A real plugin should never look like this.
