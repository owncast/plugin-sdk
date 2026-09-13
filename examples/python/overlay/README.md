# overlay

Serves a chat-overlay web page at `/plugins/overlay/`. It fetches recent history from `/plugins/overlay/api/messages`, then streams new messages through `/plugins/overlay/_sse/overlay`.

The manifest declares a `Chat Overlay` action button (`"url": "/"`, auto-prefixed by the host to `/plugins/overlay/`), so the Owncast UI surfaces a button that opens the overlay directly while this plugin is enabled. Because action buttons place UI inside Owncast's chrome, the manifest also declares the `ui.modify` permission.

**Demonstrates:** `http.serve`, static-asset serving from `public/`, dynamic HTTP handlers via `@plugin.get(...)`, `owncast.chat.history(limit)`, realtime `owncast.sse.send(...)` from `@plugin.on_chat_message`, and the `http.sse` permission.
