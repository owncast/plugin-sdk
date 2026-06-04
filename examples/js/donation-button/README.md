# donation-button

An example plugin that adds a viewer-facing donation button and an admin page for configuring it.

This example intentionally chooses **Ko-fi** over Givebutter because it is the easiest integration shape for a plugin example:

- a streamer only needs a public Ko-fi page
- no OAuth, API keys, or embed SDK are required
- the viewer experience is just a normal external action button
- the admin UI can stay focused on configuration and validation instead of payment flow complexity

**Demonstrates:** `manifest.admin.pages`, `manifest.permissions` for `ui.modify` + `http.serve` + `storage.kv`, a host-gated admin route, a plugin-owned JSON settings API, validation of admin input, and runtime viewer button updates via `owncast.actions.add()`.

## What the admin configures

- Ko-fi username or full Ko-fi URL
- button title
- button description
- button color

If the Ko-fi field is blank, the plugin removes the button.

## How it works

1. The admin page at `/plugins/donation-button/admin/` loads the saved settings from `GET /admin/api/settings`.
2. Saving the form posts JSON to `POST /admin/api/settings`.
3. The plugin validates the Ko-fi input, normalizes it into `https://ko-fi.com/<username>`, persists it in plugin KV storage, then republishes the viewer action with `owncast.actions.clear()` + `owncast.actions.add()`.
4. Viewers see a single donation button in Owncast's action-button area.

## Build and test

```sh
npm install
npm test
npm run package
```

Copy `donation-button.ocpkg` into Owncast's plugin directory, enable it, then open the plugin's admin page to configure the donation destination.
