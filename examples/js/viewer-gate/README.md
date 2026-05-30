# viewer-gate

Example plugin that combines `manifest.styles` and `manifest.scripts`. On every viewer page load the plugin mounts a confirmation modal asking *Are you sure you want to view this page?* Yes dismisses the modal; No redirects the tab to `yahoo.com`.

```json
{
  "permissions": ["ui.modify", "http.serve"],
  "styles": ["modal.css"],
  "scripts": ["gate.js"]
}
```

Requires `ui.modify` (the plugin paints UI inside the viewer chrome) and `http.serve` (the host serves both bundled assets from `/plugins/viewer-gate/`).

Useful as a template for plugins that need both CSS and JavaScript to ship together. Every selector in `modal.css` is scoped under `#viewer-gate-overlay`, and the `gate.js` mount routine creates its DOM under that same id so the plugin can't bleed into the host page.
