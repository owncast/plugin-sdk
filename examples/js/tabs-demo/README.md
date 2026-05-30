# tabs-demo

Example plugin for `manifest.tabs`: contributes two viewer-page tabs (Music + Schedule) alongside the built-in tabs.

```json
{
  "permissions": ["ui.modify"],
  "tabs": [
    { "title": "Music", "content": "music.html" },
    { "title": "Schedule", "content": "schedule.html" }
  ]
}
```

Requires `ui.modify` (the plugin paints inside Owncast's chrome). `http.serve` is not required: each tab's HTML is read from `assets/` and inlined into the tab body on `/api/config`, not served at a URL.

When enabled, viewers see two new tabs in the row alongside Followers/About. Use this as a starting point for plugins that add their own panels to the viewer page.
