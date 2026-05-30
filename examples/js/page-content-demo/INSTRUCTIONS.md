# Page Content Demo

Smallest possible example of the `manifest.extraPageContent` capability. The plugin ships a single HTML file and the host inlines its bytes at the top of the viewer page's extra-content block.

## What you'll see when enabled

An amber-bordered banner appears at the top of the viewer page's extra-content block reading:

> page-content-demo: HTML reached the viewer page's extra-content block.

The contribution lands above whatever the admin has written into the extra page content field, so any page content the admin has configured continues to render unchanged underneath.

## How it works

The manifest declares a single HTML asset:

```json
{
  "permissions": ["ui.modify"],
  "extraPageContent": "content.html"
}
```

The host rewrites the bare path to `/plugins/page-content-demo/content.html` (the canonical form), reads the file's bytes from the plugin, and prepends them to the admin's rendered `extraPageContent` on `/api/config`. Each contribution is wrapped with an `<!-- plugin: <slug> ... -->` comment so a reader can attribute the markup back to the plugin that shipped it.

## Permissions

- **ui.modify** — the plugin paints inside Owncast's chrome.

`http.serve` is not required because the HTML is inlined into the `/api/config` response, not served as a URL.

## When to use this as a template

Start here if you want to ship inline HTML for the viewer page: a sponsor banner, an announcement strip, a static call-to-action. Plugin HTML doesn't go through the markdown processor, so HTML tags and attributes pass through unmodified.
