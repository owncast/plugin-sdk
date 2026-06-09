# Example Admin Demo

This example demonstrates how a plugin bundles author-written instructions. The
file is named `INSTRUCTIONS.md`, lives at the root of the plugin project, and is
packaged into the `.ocpkg` automatically. The Owncast admin renders it as
markdown in an **Instructions** tab on the plugin's details page.

## What this plugin does

- Serves a public landing page at `/plugins/admin-demo/`.
- Adds two admin-gated pages (see the **Example Page 1** / **Example Page 2**
  tabs) backed by the plugin's own HTTP handler and key-value storage.

## Permissions

- `http.serve` — needed to serve the landing page and admin pages.
- `storage.kv` — needed to persist the demo settings.

## Try it

Enable the plugin, then open its details page. You'll see this Instructions tab
alongside the admin-page tabs and the Permissions tab.
