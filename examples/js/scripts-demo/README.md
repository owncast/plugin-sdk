# scripts-demo

Minimal example of the `manifest.scripts` capability: a JavaScript file in `assets/client.js` is declared in the manifest and gets `<script>`-injected into the viewer page on every load.

```json
{
  "permissions": ["ui.modify"],
  "scripts": ["client.js"]
}
```

Requires `ui.modify` (the plugin runs code inside Owncast's chrome). The host reads `client.js` from `assets/` and inlines it into `/customjavascript`; no `http.serve` needed.

When enabled, viewers see a blue banner pinned to the bottom of the page reading `scripts-demo: JavaScript reached the viewer page`, plus `[scripts-demo] plugin script loaded` in the browser console and `window.__pluginScriptsDemoLoaded` set. The effect is page-level so it's visible whether or not a stream or chat is active. Use this as a starting point for plugins that extend the viewer page behavior.
