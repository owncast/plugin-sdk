# engagement-bot

A cross-platform notifier that connects Owncast events to the streamer's outside channels. When the stream goes live it pings Discord and posts a fediverse announcement. New fediverse followers trigger a browser-push notification. Mentions and replies on the fediverse get forwarded to Discord so the streamer sees them alongside their normal chatter. As a small side feature it also removes obvious chat spam.

**Demonstrates:** `owncast.notifications.discord(text)` and `.browser_push(payload)` (`notifications.send`), `owncast.fediverse.post(text)` (`fediverse.post`), `owncast.chat.delete_message(id)` (`chat.moderate`), the typed fediverse handlers (`@plugin.on_fediverse_follow`, `on_fediverse_mention`, `on_fediverse_reply`), and the `@plugin.on_stream_started` lifecycle handler.

The plugin uses the integrations the server is already configured with: Discord / browser-push go through the host's notification channels, and `fediverse.post` uses the server's federated account. None of them are configured by the plugin.
