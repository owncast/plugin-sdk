# Chat Overlay

Serves a standalone **chat overlay** web page. It works well as a browser source in OBS or as a second-screen chat view. The page polls the plugin for recent chat history and renders messages live.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Open the overlay at **`/plugins/overlay/`** on your Owncast server (e.g. `https://your-server/plugins/overlay/`). The plugin also adds a **Chat Overlay** action button to the viewer page that opens it directly.
3. Add that URL as a browser source in your broadcasting software, or open it in its own tab.

The page fetches recent messages from `/plugins/overlay/api/messages` on an interval and updates automatically.

## Permissions

- **http.serve**: serves the overlay page and its JSON messages endpoint.
- **chat.history**: reads recent chat messages to render.
- **ui.modify**: adds the "Chat Overlay" action button to the viewer chrome.
