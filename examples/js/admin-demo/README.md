# admin-demo

A public landing page plus an admin-only settings panel at `/plugins/admin-demo/admin/`. The admin routes are gated by the host before the plugin sees them — the plugin doesn't have to check auth itself.

**Demonstrates:** `manifest.admin.pages` for declaring admin-only routes (the host enforces auth via the glob), the split between public and admin endpoints, persisting settings via KV from a JSON-backed config API.
