# engagement-bot

A cross-platform notifier that connects Owncast events to the streamer's outside channels. When the stream goes live it pings Discord and posts a fediverse announcement. Fediverse follows trigger browser push. Likes, reposts, quotes, mentions, replies, and raw inbound activities get forwarded to Discord. As a small side feature it also removes obvious chat spam.

**Demonstrates:** `owncast.notifications.discord(text)` and `.browserPush(payload)` (`notifications.send`), `owncast.fediverse.post(text)` (`fediverse.post`), `owncast.chat.deleteMessage(id)` (`chat.moderate`), all seven `fediverse.inbound` handlers (`onFediverse`, `onFediverseFollow`, `onFediverseLike`, `onFediverseRepost`, `onFediverseQuote`, `onFediverseMention`, and `onFediverseReply`), and `onStreamStarted`.
