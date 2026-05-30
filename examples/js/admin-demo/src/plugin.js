// admin-demo, shows manifest-declared admin pages. The /admin/* routes
// are auth-gated by the host; the plugin doesn't have to check anything.
//
// Layout:
//   GET  /             , public landing page (public/index.html)
//   GET  /admin/       , admin-only settings panel (public/admin/index.html)
//   GET  /admin/api/settings , admin-only JSON config read
//   POST /admin/api/settings , admin-only JSON config write
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

function settings() {
  return JSON.parse(owncast.kv.get("settings") || "{}");
}

module.exports = definePlugin({
  onHttpRequest(req) {
    if (req.method === "GET" && req.path === "/admin/api/settings") {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings()),
      };
    }
    if (req.method === "POST" && req.path === "/admin/api/settings") {
      let parsed;
      try {
        parsed = JSON.parse(req.body);
      } catch (e) {
        return { status: 400, body: "invalid JSON" };
      }
      owncast.kv.set("settings", JSON.stringify(parsed));
      return { status: 204 };
    }
    return { status: 404 };
  },
});
