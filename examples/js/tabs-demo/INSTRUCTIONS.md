# Tabs Demo

Adds two tabs to the viewer page's tab row: **Music** and **Schedule**. The tab bodies come from `assets/music.html` and `assets/schedule.html` inside the plugin.

## What you'll see when enabled

The viewer page's tab row gains two new tabs after the built-ins (About, Followers when fediverse is on):

- **Music** — a list of "what we're listening to" with three placeholder albums.
- **Schedule** — a weekly streaming schedule.

The tab content is plain HTML the plugin ships, so editing `assets/music.html` or `assets/schedule.html` and reloading the plugin changes what viewers see.

## How it works

The manifest declares two tabs. Each has a `slug` (the stable identifier Owncast uses internally and passes to handlers), a `title` (the tab label), and a `content` path pointing at a static HTML file:

```json
{
  "permissions": ["ui.modify"],
  "tabs": [
    { "title": "Music",    "slug": "music",    "content": "music.html" },
    { "title": "Schedule", "slug": "schedule", "content": "schedule.html" }
  ]
}
```

The host reads each file at `/api/config` time, inlines the bytes into a `pluginTabs[]` array on the response, and the viewer page maps each entry to a tab next to the built-ins. Tab keys are derived from the tab `slug` so a tab only unmounts when the plugin is disabled or removed.

## Permissions

- **ui.modify** — the plugin paints inside Owncast's chrome.

`http.serve` is not required because the tab body is inlined into the API response, not served at a URL.

## Static vs dynamic tabs

This example uses `content` (static HTML files). For tabs that need live data or viewer personalisation, omit `content` and implement `onTabContent({ slug, user })` in your plugin instead — the `page-content-demo` shows this pattern end to end.

## When to use this as a template

Reach for `manifest.tabs` when you want a dedicated panel viewers can click into — a music list, a sponsor section, an event schedule, a links page. For content that should sit at the top of the page above the tab row, use `manifest.extraPageContent` instead.
