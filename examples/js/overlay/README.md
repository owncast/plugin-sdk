# overlay

Serves a chat-overlay web page at `/plugins/overlay/`. Combines a static HTML page (`assets/index.html`) with a dynamic JSON endpoint (`/api/messages`) that returns recent chat history. The page polls the endpoint to render messages live.

The manifest declares a `Chat Overlay` action button (`"url": "/"`, auto-prefixed by the host to `/plugins/overlay/`), so the Owncast UI surfaces a button that opens the overlay directly while this plugin is enabled.

**Demonstrates:** the `http.serve` permission, static-asset serving from the `assets/` directory, dynamic HTTP handlers via `onHttpRequest`, `owncast.chat.history(limit)` for reading messages, `manifest.actions[]` for surfacing plugin UI as an Owncast action button.
