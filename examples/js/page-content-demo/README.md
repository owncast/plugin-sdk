# page-content-demo

Demonstrates dynamic `extraPageContent` and viewer tabs using `onPageContent` and `onTabContent`. Both slots render Mustache templates server-side with live data, so there are no static HTML fetch shims.

```json
{
  "permissions": ["ui.modify", "server.read"],
  "extraPageContent": { "slug": "banner" },
  "tabs": [
    { "title": "Stream Info", "slug": "stream-info" }
  ]
}
```

When `content` is omitted from a tab or `extraPageContent` entry, the host calls the corresponding handler at `/api/config` time and inlines the returned HTML string directly into the response.

## Handlers

**`onPageContent({ slug, user? })`** is called for the `"banner"` slot. Renders `assets/greeting.mustache` personalised with the viewer's display name (`user.displayName`), falling back to `"visitor"` for anonymous viewers.

**`onTabContent({ slug, user? })`** is called for the `"stream-info"` tab. Renders `assets/info.mustache` with live data from `owncast.stream.current()`, `owncast.server.info()`, `.tags()`, `.socials()`, and `.federation()`.

## Templates

Both handlers read their Mustache template from `assets/` at first call using `owncast.assets.readText(name)`. There is no build-time inlining and no extra fetch.

## Permissions

- **ui.modify**: required for `extraPageContent` and `tabs`.
- **server.read**: required for `owncast.stream.current()` and the other server APIs called by `onTabContent`.

`http.serve` is not required. The host calls the handlers directly and inlines the result, so no HTTP endpoint is involved.
