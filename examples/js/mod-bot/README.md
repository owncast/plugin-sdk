# mod-bot

Deletes chat messages containing spam keywords, posts to Discord when the stream starts, sends a browser-push notification on new fediverse followers, and forwards fediverse mentions/replies to Discord. Also publishes a fediverse post on stream start.

**Demonstrates:** `owncast.chat.deleteMessage(id)` (`chat.moderate`), `owncast.notifications.discord(text)` and `.browserPush(payload)` (`notifications.send`), `owncast.fediverse.post(text)` (`fediverse.post`), the typed fediverse event handlers (`onFediverseFollow`, `onFediverseMention`, `onFediverseReply`).
