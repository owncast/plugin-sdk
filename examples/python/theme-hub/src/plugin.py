# theme-hub: a hub of selectable viewer themes (Python port).
#
# The plugin ships a catalog of themes in assets/themes.json. The admin picks
# one from the admin panel, and the choice is persisted in the plugin's KV store.
# On every /api/config the host calls on_page_styles() (because the plugin
# holds ui.modify) and the returned CSS is appended to Owncast's customStyles,
# the same core-theming slot manifest.styles uses, so it restyles the whole
# viewer UI. on_page_scripts() additionally tags the page with the active id.
#
# The catalog is bundled here so the example is self-contained, but the shape
# is deliberately the same one you'd get from a remote registry: swap the
# _load_catalog() body for an owncast.http.fetch (permission network.fetch) of
# a remote themes.json and the rest of the plugin is unchanged.
#
# Endpoints (all under /admin, auth-gated by the host):
#   GET  /admin/api/state  returns {"themes": [{"id","name","description"}], "selected"}
#   POST /admin/api/state  takes {"selected": "<id>" | ""} and persists the choice
import json

from owncast_plugin import plugin, owncast

SELECTED_KEY = "selected"

_catalog = None


def _load_catalog():
    global _catalog
    if _catalog is None:
        raw = owncast.assets.read_text("themes.json") or '{"themes":[]}'
        _catalog = json.loads(raw).get("themes", [])
    return _catalog


def _find_theme(theme_id):
    for t in _load_catalog():
        if t.get("id") == theme_id:
            return t
    return None


def _selected_id():
    return owncast.kv.get(SELECTED_KEY) or ""


# The metadata the admin panel needs. Never ships the raw CSS to the listing.
def _state():
    return {
        "themes": [
            {"id": t["id"], "name": t["name"], "description": t["description"]}
            for t in _load_catalog()
        ],
        "selected": _selected_id(),
    }


# Inject the selected theme's CSS into the viewer page's customStyles. Returning
# "" (no theme selected) contributes nothing, leaving Owncast's default theme.
@plugin.on_page_styles
def page_styles():
    theme = _find_theme(_selected_id())
    if not theme:
        return ""
    return "/* theme-hub: %s */\n%s" % (theme["id"], theme["css"])


# Tag the page with the active theme id so other styles/scripts could react,
# and leave a console breadcrumb. Wrapped in an IIFE because plugin scripts
# share the viewer page's global scope.
@plugin.on_page_scripts
def page_scripts():
    theme_id = _selected_id()
    if not theme_id:
        return ""
    js_id = json.dumps(theme_id)
    return (
        "(function () {\n"
        "  document.documentElement.dataset.themeHub = %s;\n"
        '  console.info("theme-hub: active theme", %s);\n'
        "})();" % (js_id, js_id)
    )


@plugin.get("/admin/api/state")
def get_state(req):
    return {
        "status": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(_state(), separators=(",", ":")),
    }


@plugin.post("/admin/api/state")
def set_state(req):
    try:
        payload = json.loads(req.body)
    except ValueError:
        return {"status": 400, "body": "invalid JSON"}
    selected = payload.get("selected") if isinstance(payload, dict) else None
    theme_id = selected if isinstance(selected, str) else ""
    # Empty string clears the selection (back to Owncast's default theme).
    if theme_id and not _find_theme(theme_id):
        return {"status": 400, "body": "unknown theme"}
    owncast.kv.set(SELECTED_KEY, theme_id)
    return {
        "status": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(_state(), separators=(",", ":")),
    }
