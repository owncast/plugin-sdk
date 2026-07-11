# engagement-bot

A cross-platform notifier that connects Owncast events to the streamer's outside channels. When the stream goes live it pings Discord and posts a fediverse announcement. Fediverse follows trigger browser push. Likes, reposts, quotes, mentions, replies, and raw inbound activities get forwarded to Discord. As a small side feature it also removes obvious chat spam.

**Demonstrates:** `owncast.notifications.discord(text)` and `.browser_push(payload)` (`notifications.send`), `owncast.fediverse.post(text)` (`fediverse.post`), `owncast.chat.delete_message(id)` (`chat.moderate`), all seven `fediverse.inbound` handlers (`@plugin.on_fediverse`, `@plugin.on_fediverse_follow`, `@plugin.on_fediverse_like`, `@plugin.on_fediverse_repost`, `@plugin.on_fediverse_quote`, `@plugin.on_fediverse_mention`, and `@plugin.on_fediverse_reply`), and `@plugin.on_stream_started`.

The plugin uses the integrations the server is already configured with: Discord / browser-push go through the host's notification channels, and `fediverse.post` uses the server's federated account. None of them are configured by the plugin.
