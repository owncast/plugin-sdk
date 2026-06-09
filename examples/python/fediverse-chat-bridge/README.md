# fediverse-chat-bridge

When someone on the fediverse mentions or replies to the streamer, posts a system message in chat showing the poster's avatar, display name, handle (linked to their profile), and the post text (linked to the original).

**Demonstrates:** the typed `@plugin.on_fediverse_mention` / `on_fediverse_reply` handlers, `owncast.chat.system(html)` for posting an HTML system message (no user identity), and the discipline of escaping every untrusted field before inserting it into rendered HTML (the plugin ships its own `escape_html` / `safe_url` helpers).
