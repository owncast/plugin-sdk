# Viewer Gate

Example plugin that combines `manifest.styles` and `manifest.scripts`. On every viewer page load it shows a custom confirmation modal asking the visitor whether they want to proceed.

## What you'll see when enabled

The viewer page loads under a dark, blurred overlay with a centered dialog:

> **Hold up**
>
> Are you sure you want to view this page?
>
> [ Yes ]   [ No ]

- **Yes** dismisses the overlay and leaves the viewer on the page. The Yes button is focused by default, so pressing Enter dismisses without reaching for the mouse.
- **No** redirects the tab to `yahoo.com`.

The overlay sits on top of every other plugin's viewer-page injections (z-index 1000000).

## How it works

The manifest declares both a stylesheet and a script:

```json
{
  "permissions": ["ui.modify", "http.serve"],
  "styles": ["modal.css"],
  "scripts": ["gate.js"]
}
```

`modal.css` defines the overlay and modal styling. Every selector is scoped under `#viewer-gate-overlay` so the plugin's CSS can't bleed onto the rest of the host page. `gate.js` builds the modal DOM under the same id at page-load time and wires the Yes / No button handlers.

## Permissions

- **ui.modify** — the plugin paints UI inside the viewer chrome and runs JavaScript in the page's window context.
- **http.serve** — the host serves both bundled assets (`modal.css`, `gate.js`) from the plugin's namespace.

Both are required by the host before it will load a plugin that uses `manifest.styles` or `manifest.scripts`.

## When to use this as a template

Start here if your plugin needs CSS and JavaScript working together — for example: a popup, an injected toolbar, a tutorial overlay, or any UI that ships its own DOM plus its own styling. The pattern of scoping every selector under a single root id is worth keeping; without it your CSS rules can match elements the host page renders and produce surprising regressions.
