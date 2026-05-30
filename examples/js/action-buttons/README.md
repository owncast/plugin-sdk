# action-buttons

A plugin that contributes viewer action buttons through its manifest, and ships an admin page that lets the streamer add an extra button at runtime. The host's effective list for each plugin is `manifest.actions` ++ whatever the plugin has added at runtime via `owncast.actions.add(...)`. Both are merged into the viewer's `externalActions` array on `/api/config`, so plugin-contributed buttons appear next to admin-defined ones with no extra wiring.

**Demonstrates:** the `actions` manifest field, the URL-vs-HTML variants, the `openExternally` flag, the `color` styling hook, the `ui.modify` permission, the runtime `owncast.actions.add` / `.clear` API, an admin page (`manifest.admin.pages`), and a custom HTTP API served via `onHttpRequest`.

## Permission

Action buttons place UI inside Owncast's own viewer chrome, so the manifest must declare `"ui.modify"` in its `permissions` array. The host rejects a manifest at load time if `actions` is set without `ui.modify`, and the runtime `owncast.actions.add` / `.clear` calls throw the same permission error if it isn't granted.

## How buttons reach the viewer

1. The plugin declares any always-on buttons under `manifest.actions[]`.
2. On load (or reload), the host parses the manifest and validates each entry: title is required, exactly one of `url` or `html` must be present, relative URLs are rewritten into this plugin's namespace, cross-plugin URLs are rejected.
3. At runtime, `owncast.actions.add(buttons)` appends to the plugin's effective list. The host runs the same validation on each entry and persists the result in the plugin's config.
4. `owncast.actions.clear()` drops the runtime additions; only the manifest's defaults remain.
5. On every viewer `/api/config` request, the host returns `manifest.actions` ++ the runtime list, projected into Owncast's existing `ExternalAction` shape.

## Action shapes

```jsonc
{
  "actions": [
    {
      "title": "Owncast",                  // required
      "description": "...",                // optional, shown in the modal
      "url": "https://owncast.online",     // exactly one of url/html
      "openExternally": true,              // optional: new tab vs in-modal
      "color": "#24292e",                  // optional: button bg color
      "icon": "/star.png"                  // optional: image URL; a relative path
                                            //   ("/star.png") resolves to this
                                            //   plugin's static assets, and any
                                            //   "https://..." URL is left alone
    },
    {
      "title": "About this stream",
      "html": "<div>...</div>"             // inline HTML modal body
    }
  ]
}
```

## Adding a custom button from an admin page

This plugin's manifest also declares `admin.pages` and asks for `http.serve` + `storage.kv`. `src/plugin.js` handles two endpoints:

- `GET /admin/api/custom-button` returns the streamer's saved title + url from plugin config (or empty strings if none).
- `POST /admin/api/custom-button` accepts `{ title, url }`, persists the value to plugin config, then publishes it to the host via `owncast.actions.clear()` followed by `owncast.actions.add({ title, url, ... })`.

The admin form (`public/admin/index.html`) is auto-themed by the host's plugin-iframe stylesheet, so plain `<input>` and `<button>` controls look like the surrounding Owncast admin without any plugin-side CSS.

## Build and install

```sh
npm install
npm run package
cp action-buttons.ocpkg <owncast>/data/plugins/
```

Then enable the plugin from the admin and reload the viewer to see the buttons.
