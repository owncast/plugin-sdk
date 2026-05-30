# styles-demo

Minimal example of the `manifest.styles` capability: a CSS file in `assets/theme.css` is declared in the manifest and gets `<link>`-injected into the viewer page's global scope on every load.

```json
{
  "permissions": ["ui.modify", "http.serve"],
  "styles": ["theme.css"]
}
```

Requires `ui.modify` (the plugin restyles the viewer's own chrome) and `http.serve` (the host serves the bundled CSS at `/plugins/styles-demo/theme.css`).

When enabled, viewers see a salmon-pink banner pinned to the top of the page reading `styles-demo: CSS reached the viewer page`. The effect is page-level so it's visible whether or not a stream or chat is active. Use this as a starting point for theming plugins.
