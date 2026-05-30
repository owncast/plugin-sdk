# Scripts Demo

Smallest possible example of the `manifest.scripts` capability. The plugin ships a single JavaScript file and the host injects it as a `<script>` tag on every viewer page.

## What you'll see when enabled

A blue banner pinned to the **bottom** of the viewer page reading:

> scripts-demo: JavaScript reached the viewer page

Open the browser devtools and you'll also see:

- Console: `[scripts-demo] plugin script loaded`
- `window.__pluginScriptsDemoLoaded === true`

The banner is built by the script at page-load time, so it appears whether or not a stream is live, with or without chat, on every page.

## How it works

The manifest declares one JavaScript asset:

```json
{
  "permissions": ["ui.modify"],
  "scripts": ["client.js"]
}
```

The host reads `client.js` from the plugin's `assets/` directory and concatenates its bytes onto the response served at `/customjavascript`. The viewer loads one `<script>` tag covering admin JS + every loaded plugin's contribution.

## Permissions

- **ui.modify** — the plugin runs JavaScript in the viewer page's window context.

`http.serve` is not required: the bytes are inlined into the `/customjavascript` response, not served at a URL.

## When to use this as a template

Start here if you want to extend the viewer page's behavior at runtime — analytics beacons, third-party widget bootstrappers, custom DOM that responds to viewer interaction. The script runs in the same window as the host's chrome, so you have full DOM access and can read/write anything the host page renders.
