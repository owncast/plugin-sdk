# stream-tracker

Tracks who's currently in chat and when the stream started, persists that state in KV, and answers `!uptime`, `!who`, and `!server` chat commands. Posts action-style ("/me") announcements when the stream starts or its title changes.

**Demonstrates:** every typed event handler — `onStreamStarted`, `onStreamStopped`, `onStreamTitleChanged`, `onChatUserJoined`, `onChatUserParted`, `onChatUserRenamed` — plus the read APIs `owncast.stream.current()` and `owncast.server.info()`, and the `sendAction` chat variant.
