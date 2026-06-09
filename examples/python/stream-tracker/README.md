# stream-tracker

Tracks who's currently in chat and when the stream started, persists that state in plugin config, and answers `!uptime`, `!who`, and `!server` chat commands. Posts action-style ("/me") announcements when the stream starts or its title changes.

**Demonstrates:** every typed event handler — `@plugin.on_stream_started`, `on_stream_stopped`, `on_stream_title_changed`, `on_chat_user_joined`, `on_chat_user_parted`, `on_chat_user_renamed` — plus the read APIs `owncast.stream.current()` and `owncast.server.info()`, and the `owncast.chat.send_action` chat variant.
