# Custom Action Buttons

Adds buttons to the viewer page's action-button row, and gives you an admin page to add one of your own at runtime.

## What you'll see when enabled

Three buttons appear in the viewer's action area:

- **Owncast** opens owncast.online in a new tab.
- **GitHub** opens the Owncast source on GitHub in a new tab.
- **About this stream** opens an inline HTML modal instead of navigating away.

## Adding your own button

1. Enable the plugin in **Admin → Plugins**.
2. Open the **Button labels** admin page (the gear icon in the sidebar).
3. Enter a **title** and a **URL**, then save.
4. Reload the viewer page. Your button appears in the row alongside the built-in ones.

Saving replaces any previously-added custom button, and the value persists across server restarts.

## Permissions

- **ui.modify**: action buttons render inside Owncast's own viewer chrome.
- **http.serve**: serves the admin page and the small API behind the save form.
- **storage.kv**: persists your custom button's title and URL.
