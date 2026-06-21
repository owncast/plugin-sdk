# tabs-demo

Example plugin for `manifest.tabs`: contributes two static viewer-page tabs (Music + Schedule) alongside the built-in tabs.

```json
{
  "permissions": ["ui.modify"],
  "tabs": [
    { "title": "Music",    "slug": "music",    "content": "music.html" },
    { "title": "Schedule", "slug": "schedule", "content": "schedule.html" }
  ]
}
```

Each tab has a `slug` (stable identifier), a `title` (tab label), and a `content` path pointing at a static HTML file in `assets/`. When `content` is present the host reads the file and inlines it directly, and no plugin code runs. When `content` is omitted the host calls `onTabContent({ slug, user? })` so the plugin can render dynamic content per viewer.

Requires `ui.modify` (the plugin paints inside Owncast's chrome). `http.serve` is not required: each tab's HTML is read from `assets/` and inlined into the tab body on `/api/config`, not served at a URL.

When enabled, viewers see two new tabs in the row alongside Followers/About. Use this as a starting point for static tab content. For live data or personalised content, see `page-content-demo` for the dynamic handler pattern.
