# Page Content Demo

Demonstrates dynamic viewer page content rendered server-side with Mustache. The plugin contributes a personalised banner above the tab row and a live "Stream Info" tab — both rendered at request time with no static HTML files or client-side fetch calls.

## What you'll see when enabled

**Banner (extra page content):** An amber-bordered panel at the top of the viewer page's extra-content block greeting the viewer by their chat display name. Anonymous viewers see "visitor".

**Stream Info tab:** A new tab in the viewer tab row showing live stream state (online/offline, title, viewer count, started time), server metadata (name, version, URL), tags, social handles, and federation status — all rendered from `owncast.stream.current()` and related APIs.

## How it works

The manifest declares the two slots without `content` paths, which tells the host to call the plugin's handlers instead of reading static files:

```json
{
  "permissions": ["ui.modify", "server.read"],
  "extraPageContent": { "slug": "banner" },
  "tabs": [
    { "title": "Stream Info", "slug": "stream-info" }
  ]
}
```

When Owncast builds its `/api/config` response it calls:

- `onPageContent({ slug: "banner", user? })` to get the banner HTML
- `onTabContent({ slug: "stream-info", user? })` to get the tab HTML

Both handlers load their Mustache template from `assets/` via `owncast.assets.readText(name)` and render it with the relevant data.

## Templates

- `assets/greeting.mustache` — the banner; uses `{{displayName}}` with Mustache's auto-escaping.
- `assets/info.mustache` — the stream info tab; uses `{{#stream.online}}` / `{{^stream.online}}` conditionals and `{{#tags}}{{.}}{{/tags}}` iteration.

## Permissions

- **ui.modify** — required for `extraPageContent` and `tabs`.
- **server.read** — required by `onTabContent` to call `owncast.stream.current()`, `owncast.server.info()`, etc.

`http.serve` is not needed. The host calls the handlers directly and inlines the returned HTML; there are no plugin HTTP endpoints.

## Testing

Scenarios in `__tests__/` use the `pageContent` and `tabContent` step types to exercise the handlers directly:

```json
{
  "pageContent": {
    "slug": "banner",
    "user": { "id": "u-alice", "displayName": "Alice" },
    "expect": { "bodyContains": "Alice" }
  }
}
```
