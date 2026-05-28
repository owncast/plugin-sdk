// action-buttons: contributes viewer action buttons via the manifest AND
// ships an admin page that lets the streamer add a custom button on top
// of those defaults. Demonstrates two integrations at once:
//
//   - UI updates: owncast.actions.add(buttons) appends to the plugin's
//     effective list. The viewer chrome picks up the new entries on the
//     next /api/config response without a plugin reload.
//
//   - Custom API: the admin page (assets/admin/index.html) talks to
//     /admin/api/custom-button — a plugin-owned endpoint — which
//     persists the streamer's input to the plugin's config and pushes
//     it through to the host. Auth gating on /admin/* comes from the
//     host.
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

// Key the plugin owns inside its own config to remember the streamer's
// custom button between requests. Distinct from the host-reserved
// `owncast.actions` key the SDK manages internally.
const CUSTOM_BUTTON_KEY = "custom-button";

function loadCustomButton() {
  const raw = owncast.kv.get(CUSTOM_BUTTON_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.title === "string" && typeof parsed.url === "string") {
      return parsed;
    }
  } catch (_e) {
    /* fall through */
  }
  return null;
}

// Re-publish the saved button (if any) into the host's runtime list.
// Called on POST after a save and on the GET fetch so the host stays
// in sync with whatever the plugin has remembered.
function publishCustomButton() {
  owncast.actions.clear();
  const button = loadCustomButton();
  if (button) {
    owncast.actions.add({
      title: button.title,
      url: button.url,
      description: "Added at runtime from the action-buttons admin page",
      openExternally: true,
    });
  }
}

module.exports = definePlugin({
  onHttpRequest(req) {
    if (req.method === "GET" && req.path === "/admin/api/custom-button") {
      // Reflect the host's runtime state back to the form on every load
      // so what the admin sees matches what viewers see.
      publishCustomButton();
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(loadCustomButton() || { title: "", url: "" }),
      };
    }

    if (req.method === "POST" && req.path === "/admin/api/custom-button") {
      let payload;
      try {
        payload = JSON.parse(req.body);
      } catch (_e) {
        return { status: 400, body: "invalid JSON" };
      }
      const title = typeof payload?.title === "string" ? payload.title.trim() : "";
      const url = typeof payload?.url === "string" ? payload.url.trim() : "";
      if (!title && !url) {
        owncast.kv.delete && owncast.kv.delete(CUSTOM_BUTTON_KEY);
        // Older SDK versions may not expose kv.delete; just overwrite
        // with an empty value so loadCustomButton returns null.
        owncast.kv.set(CUSTOM_BUTTON_KEY, "");
        owncast.actions.clear();
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "", url: "" }),
        };
      }
      if (!title || !url) {
        return { status: 400, body: "both title and url are required" };
      }
      owncast.kv.set(CUSTOM_BUTTON_KEY, JSON.stringify({ title, url }));
      publishCustomButton();
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, url }),
      };
    }

    return { status: 404 };
  },
});
