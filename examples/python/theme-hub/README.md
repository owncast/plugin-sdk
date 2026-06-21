# theme-hub

A hub of selectable viewer themes. Ships a small catalog of themes, lets the admin pick one from an admin panel, and applies the selected theme to the **whole viewer UI** through Owncast's core theming. It uses the dynamic `on_page_styles` hook rather than a static `manifest.styles` file. Python port of the [JavaScript example](../../js/theme-hub/), with the same manifest and behavior.

It's intended as a template for a real plugin that fetches a remote theme catalog: the catalog here is hardcoded in `assets/themes.json`, but `_load_catalog()` is the only thing you'd swap for an `owncast.http.fetch` of a remote `themes.json`.

## How it works

```
admin picks a theme  ──POST /admin/api/state──▶  owncast.kv "selected"
                                                       │
/api/config  ──host calls on_page_styles()──▶  CSS for the selected theme
             ──host calls on_page_scripts()─▶  tags <html> with the theme id
```

- **`@plugin.on_page_styles`** returns the selected theme's CSS. The host appends it to `/api/config` → `customStyles` (the same slot `manifest.styles` feeds), so it restyles the entire viewer UI. Returning `""` leaves Owncast's default theme in place. No manifest field is needed, since the host calls the hook for any plugin holding `ui.modify`.
- **`@plugin.on_page_scripts`** returns a tiny IIFE that sets `document.documentElement.dataset.themeHub` to the active theme id. Dynamic counterpart to `manifest.scripts`. The host wraps every plugin script in a `try/catch` so a throw can't break the page.
- **`@plugin.get` / `@plugin.post`** serve the admin API at `/admin/api/state`. The `/admin/*` routes are auth-gated by the host.
- The selection is persisted in the plugin's namespaced KV store under the `selected` key.

## The themes

`assets/themes.json` holds three themes (`midnight`, `sunset`, `forest`). Each entry is `{ id, name, description, css }`, where `css` overrides Owncast's `--theme-color-*` design tokens (the same variables the admin Appearance editor sets) plus the corner radius.

## Permissions

- **ui.modify**: required for `on_page_styles` and `on_page_scripts`.
- **http.serve**: the admin panel and its `/admin/api/state` endpoint.
- **storage.kv**: persists the selected theme id.

## Testing

`__tests__/theme.test.json` exercises the hooks directly with the `pageStyles` and `pageScripts` step types, plus `http` steps for the admin API. The scenarios are identical to the JavaScript port.
