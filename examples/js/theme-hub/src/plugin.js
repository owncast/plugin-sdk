// theme-hub: a hub of selectable viewer themes.
//
// The plugin ships a catalog of themes in assets/themes.json. The admin picks
// one from the admin panel; the choice is persisted in the plugin's KV store.
// On every /api/config the host calls onPageStyles() — because the plugin holds
// ui.modify — and the returned CSS is appended to Owncast's customStyles, the
// same core-theming slot manifest.styles uses, so it restyles the whole viewer
// UI. onPageScripts() additionally tags the page with the active theme id.
//
// The catalog is bundled here so the example is self-contained, but the shape
// is deliberately the same one you'd get from a remote registry: swap the
// loadCatalog() body for an owncast.http.fetch (permission network.fetch) of a
// remote themes.json and the rest of the plugin is unchanged.
//
// Endpoints (all under /admin, auth-gated by the host):
//   GET  /admin/api/state  — { themes: [{ id, name, description }], selected }
//   POST /admin/api/state  — { selected: "<id>" | "" } -> persists the choice
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const SELECTED_KEY = "selected";

let catalogCache = null;

function loadCatalog() {
  if (!catalogCache) {
    const raw = owncast.assets.readText("themes.json") || '{"themes":[]}';
    catalogCache = JSON.parse(raw).themes || [];
  }
  return catalogCache;
}

function findTheme(id) {
  return loadCatalog().find((t) => t.id === id) || null;
}

function selectedId() {
  return owncast.kv.get(SELECTED_KEY) || "";
}

// The metadata the admin panel needs — never ships the raw CSS to the listing.
function state() {
  return {
    themes: loadCatalog().map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    selected: selectedId(),
  };
}

module.exports = definePlugin({
  // Inject the selected theme's CSS into the viewer page's customStyles.
  // Returning "" (no theme selected) contributes nothing, leaving Owncast's
  // default theme in place.
  onPageStyles() {
    const theme = findTheme(selectedId());
    if (!theme) return "";
    return `/* theme-hub: ${theme.id} */\n${theme.css}`;
  },

  // Tag the page with the active theme id so other styles/scripts could react,
  // and leave a console breadcrumb. Wrapped in an IIFE because plugin scripts
  // share the viewer page's global scope.
  onPageScripts() {
    const id = selectedId();
    if (!id) return "";
    return `(function () {
  document.documentElement.dataset.themeHub = ${JSON.stringify(id)};
  console.info("theme-hub: active theme", ${JSON.stringify(id)});
})();`;
  },

  onHttpRequest(req) {
    if (req.path === "/admin/api/state") {
      if (req.method === "GET") {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(state()),
        };
      }
      if (req.method === "POST") {
        let payload;
        try {
          payload = JSON.parse(req.body);
        } catch (_e) {
          return { status: 400, body: "invalid JSON" };
        }
        const id = typeof payload?.selected === "string" ? payload.selected : "";
        // Empty string clears the selection (back to Owncast's default theme).
        if (id && !findTheme(id)) {
          return { status: 400, body: "unknown theme" };
        }
        owncast.kv.set(SELECTED_KEY, id);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(state()),
        };
      }
    }
    return { status: 404 };
  },
});
