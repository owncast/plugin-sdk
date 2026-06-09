# action-buttons

A plugin that contributes viewer action buttons through its manifest, and ships an admin page that lets the streamer add an extra button at runtime. The host's effective list for each plugin is `manifest.actions` ++ whatever the plugin has added at runtime via `owncast.actions.add(...)`. Both are merged into the viewer's `externalActions` array on `/api/config`, so plugin-contributed buttons appear next to admin-defined ones with no extra wiring.

**Demonstrates:** the `actions` manifest field, the URL-vs-HTML variants, the `openExternally` flag, the `color` styling hook, the `ui.modify` permission, the runtime `owncast.actions.add` / `.clear` API, an admin page (`manifest.admin.pages`), and a custom HTTP API served via `@plugin.get` / `@plugin.post`.

## Permission

Action buttons place UI inside Owncast's own viewer chrome, so the manifest must declare `"ui.modify"` in its `permissions` array. The host rejects a manifest at load time if `actions` is set without `ui.modify`, and the runtime `owncast.actions.add` / `.clear` calls raise the same permission error if it isn't granted.

## Adding a custom button from an admin page

This plugin's manifest also declares `admin.pages` and asks for `http.serve` + `storage.kv`. `src/plugin.py` handles two endpoints:

- `GET /admin/api/custom-button` returns the streamer's saved title + url from plugin config (or empty strings if none).
- `POST /admin/api/custom-button` accepts `{ title, url }`, persists the value with `owncast.kv.set`, then publishes it to the host via `owncast.actions.clear()` followed by `owncast.actions.add({ title, url, ... })`.

The admin form (`public/admin/index.html`) is auto-themed by the host's plugin-iframe stylesheet, so plain `<input>` and `<button>` controls look like the surrounding Owncast admin without any plugin-side CSS.
