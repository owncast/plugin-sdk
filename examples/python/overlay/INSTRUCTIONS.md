# Chat Overlay

Serves a standalone **chat overlay** web page. It works as a browser source in OBS or as a second-screen chat view. The page loads recent messages once, then receives new messages immediately.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Open the overlay at **`/plugins/overlay/`** on your Owncast server (e.g. `https://your-server/plugins/overlay/`). The plugin also adds a **Chat Overlay** action button to the viewer page that opens it directly.
3. Add that URL as a browser source in your broadcasting software, or open it in its own tab.

The page fetches recent messages from `/plugins/overlay/api/messages` when it opens, then listens on `/plugins/overlay/_sse/overlay` for new chat messages.

## Permissions

- **http.serve**: serves the overlay page and its JSON messages endpoint.
- **http.sse**: streams new chat messages to the overlay.
- **chat.history**: reads recent chat messages when the overlay opens.
- **ui.modify**: adds the "Chat Overlay" action button to the viewer chrome.
