# page-content-demo

Smallest possible example of the `manifest.extraPageContent` capability. The plugin ships a single HTML file and the host inlines its bytes at the top of the viewer page's extra-content block.

```json
{
  "permissions": ["ui.modify"],
  "extraPageContent": "content.html"
}
```

Requires `ui.modify` (the plugin paints inside Owncast's chrome). `http.serve` is not required because the HTML is inlined into the `/api/config` response, not served as a URL.

When enabled, viewers see an amber banner reading `page-content-demo: HTML reached the viewer page's extra-content block` at the top of the extra-content section.
