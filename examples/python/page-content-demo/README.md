# page-content-demo

Demonstrates dynamic `extraPageContent` and viewer tabs using `on_page_content` and `on_tab_content`. Both slots render Mustache templates server-side with live data. No static HTML fetch shims needed.

```json
{
  "permissions": ["ui.modify", "server.read"],
  "extraPageContent": { "slug": "banner" },
  "tabs": {
    "stream-info": { "title": "Stream Info" }
  }
}
```

When `content` is omitted from a tab or `extraPageContent` entry, the host calls the corresponding handler at `/api/config` time and inlines the returned HTML string directly into the response.

## Handlers

**`on_page_content`** is called for the `"banner"` slot. Renders `assets/greeting.mustache` personalised with the viewer's display name, falling back to `"visitor"` for anonymous viewers.

**`on_tab_content`** is called for the `"stream-info"` tab. Renders `assets/info.mustache` with live data from `owncast.stream.current()`, `owncast.server.info()`, and related read APIs.

Both handlers read their template from `assets/` at first call using `owncast.assets.read_text(name)`. The JS version uses the `mustache` npm package, but a Python plugin can't pull in a PyPI package, so this example keeps a small dependency-free Mustache-subset renderer in `src/mini_mustache.py` and imports it from `plugin.py`. It produces the same HTML the JS `Mustache.render()` does for the features the two templates use (`{{var}}`, `{{{var}}}`, dotted paths, `{{#section}}` / `{{^inverted}}`, `{{.}}`).

## Permissions

- **ui.modify**: required for `extraPageContent` and `tabs`.
- **server.read**: required for `owncast.stream.current()` and the other server APIs called by `on_tab_content`.

`http.serve` is not required. The host calls the handlers directly and inlines the result, so no HTTP endpoint is involved.
