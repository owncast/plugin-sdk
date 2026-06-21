# scripts-demo

Minimal example of the `manifest.scripts` capability: a JavaScript file in `assets/client.js` is declared in the manifest and gets `<script>`-injected into the viewer page on every load. (The injected file is browser JavaScript. The plugin itself is authored in Python, and only the viewer-page asset is JS.)

```json
{
  "permissions": ["ui.modify"],
  "scripts": ["client.js"]
}
```

Requires `ui.modify` (the script runs inside Owncast's chrome). The host reads `client.js` from `assets/` and inlines it into `/customjavascript`, no `http.serve` needed. This is a pure-manifest capability, so there's no Python handler code.

When enabled, viewers see a blue banner pinned to the bottom of the page reading `scripts-demo: JavaScript reached the viewer page`, plus `[scripts-demo] plugin script loaded` in the browser console and `window.__pluginScriptsDemoLoaded` set. The effect is page-level so it's visible whether or not a stream or chat is active. Use this as a starting point for plugins that extend the viewer page behavior.
