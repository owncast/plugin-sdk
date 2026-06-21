# Safeguard Stress (demo)

A test fixture, not a usable plugin. It misbehaves on demand by spinning in tight loops, returning oversized output, and trying to allocate past the wasm memory cap. This verifies that the host's sandbox limits actually stop it.

## What it's for

The host enforces per-call timeouts, output-size caps, and a wasm memory limit on every plugin. This plugin exists so the host's automated safeguard tests can trigger each of those limits and confirm the plugin is contained rather than taking down the server.

There is no reason to enable this on a real server. Read its source if you want to understand what the sandbox protects against.

## Permissions

- **http.serve**, **chat.filter**: present only so the fixture can exercise those code paths under load. They demonstrate nothing useful for a real plugin.
