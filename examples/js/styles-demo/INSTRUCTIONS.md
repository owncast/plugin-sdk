# Styles Demo

Smallest possible example of the `manifest.styles` capability. The plugin ships a single CSS file and the host injects it into every viewer page's global stylesheet scope.

## What you'll see when enabled

A salmon-pink banner pinned to the **top** of the viewer page reading:

> styles-demo: CSS reached the viewer page

The banner is rendered through `body::before`, so it shows up whether or not a stream is live, with or without chat, on every page load. Open devtools and `getComputedStyle(document.documentElement).getPropertyValue('--plugin-styles-demo-loaded')` returns `1` — the plugin also sets a CSS custom property so other plugins or admin styles can detect that the demo is active.

## How it works

The manifest declares one CSS asset:

```json
{
  "permissions": ["ui.modify", "http.serve"],
  "styles": ["theme.css"]
}
```

The host rewrites that bare path to `/plugins/styles-demo/theme.css` and adds the URL to the viewer config's `pluginStyles` list. The viewer page renders a `<link rel="stylesheet">` for each entry, alongside the admin's own customStyles.

## Permissions

- **ui.modify** — the plugin paints inside Owncast's chrome (the banner overlays the page).
- **http.serve** — the host serves the bundled `theme.css` from the plugin's namespace.

Both are required by the host before it will load a plugin that uses `manifest.styles`.

## When to use this as a template

Start here if you want to ship custom CSS that themes the viewer page — color overrides, layout tweaks, custom fonts via `@font-face` inside the CSS, etc. Everything you can do in CSS is fair game; the host doesn't sandbox the stylesheet beyond serving it from your plugin's URL namespace.
