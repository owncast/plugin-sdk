# engagement-bot

A cross-platform notifier that connects Owncast events to the streamer's outside channels. When the stream goes live it pings Discord and posts a fediverse announcement; new fediverse followers trigger a browser-push notification; mentions and replies on the fediverse get forwarded to Discord so the streamer sees them alongside their normal chatter. As a small side feature it also removes obvious chat spam.

**Demonstrates:** `owncast.notifications.discord(text)` and `.browserPush(payload)` (`notifications.send`), `owncast.fediverse.post(text)` (`fediverse.post`), `owncast.chat.deleteMessage(id)` (`chat.moderate`), the typed fediverse handlers (`onFediverseFollow`, `onFediverseMention`, `onFediverseReply`), and the `onStreamStarted` lifecycle handler.
