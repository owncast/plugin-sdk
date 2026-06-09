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
  "permissions": ["ui.modify"],
  "styles": ["theme.css"]
}
```

The host reads `theme.css` from the plugin's `assets/` directory and concatenates its bytes onto the admin's customStyles on `/api/config`. The viewer renders one inline `<style>` block covering admin CSS + every loaded plugin's contribution.

## Permissions

- **ui.modify** — the plugin paints inside Owncast's chrome (the banner overlays the page).

`http.serve` is not required: the bytes are inlined into the config response, not served at a URL.

## When to use this as a template

Start here if you want to ship custom CSS that themes the viewer page — color overrides, layout tweaks, custom fonts via `@font-face` inside the CSS. Everything you can do in CSS is fair game; the host doesn't sandbox the stylesheet beyond reading it out of the plugin's `assets/`.
