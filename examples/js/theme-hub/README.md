# theme-hub

A hub of selectable viewer themes. Ships a small catalog of themes, lets the admin pick one from an admin panel, and applies the selected theme to the **whole viewer UI** through Owncast's core theming — using the dynamic `onPageStyles` hook rather than a static `manifest.styles` file.

It's intended as a template for a real plugin that fetches a remote theme catalog: the catalog here is hardcoded in `assets/themes.json`, but the load path (`loadCatalog()`) is the only thing you'd swap for an `owncast.http.fetch` of a remote `themes.json`.

## How it works

```
admin picks a theme  ──POST /admin/api/state──▶  owncast.kv "selected"
                                                       │
/api/config  ──host calls onPageStyles()──▶  CSS for the selected theme
             ──host calls onPageScripts()─▶  tags <html> with the theme id
```

- **`onPageStyles()`** returns the selected theme's CSS. The host appends it to `/api/config` → `customStyles` (the same slot `manifest.styles` feeds), so it restyles the entire viewer UI. Returning `""` (no theme selected) leaves Owncast's default theme in place. No manifest field is needed — the host calls the hook for any plugin holding `ui.modify`.
- **`onPageScripts()`** returns a tiny IIFE that sets `document.documentElement.dataset.themeHub` to the active theme id and logs it. Dynamic counterpart to `manifest.scripts`; the host wraps every plugin script in a `try/catch` so a throw can't break the page.
- **`onHttpRequest`** serves the admin API at `/admin/api/state` (GET the catalog + current selection, POST to change it). The `/admin/*` routes are auth-gated by the host.
- The selection is persisted in the plugin's namespaced KV store under the `selected` key.

## The themes

`assets/themes.json` holds three themes (`midnight`, `sunset`, `forest`). Each entry is `{ id, name, description, css }`, where `css` overrides Owncast's `--theme-color-*` design tokens (Background, Action, Chat, etc. — the same variables the admin Appearance editor sets) plus the corner radius. Because the CSS lands in `customStyles`, a theme's `:root` overrides win over the defaults.

## Permissions

- **ui.modify** — required for both `onPageStyles` and `onPageScripts` (the plugin restyles Owncast's own UI).
- **http.serve** — the admin panel and its `/admin/api/state` endpoint.
- **storage.kv** — persists the selected theme id.

## Testing

`__tests__/theme.test.json` exercises the hooks directly with the `pageStyles` and `pageScripts` step types, plus `http` steps for the admin API:

```json
{
  "given": { "kv": { "selected": "midnight" } },
  "events": [
    { "pageStyles": { "expect": { "bodyContains": "--theme-color-action: #5b8cff" } } }
  ]
}
```

```sh
cd examples/js/theme-hub
npm install
npm test
```
