// manual-video-settings: admin form that drives owncast.videoConfig.
// All editing is done through host-gated /admin/* routes, so the plugin
// itself doesn't have to check auth; the host rejects unauthenticated
// requests before they reach onHttpRequest.
//
//   GET  /admin/             , admin form (public/admin/index.html)
//   GET  /admin/api/config   , current VideoConfig (videoconfig.read)
//   POST /admin/api/config   , apply a VideoConfigUpdate (videoconfig.write)
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

function parseVariant(v) {
  return {
    width: Number(v.width) || 0,
    height: Number(v.height) || 0,
    framerate: Number(v.framerate) || 0,
    videoBitrate: Number(v.videoBitrate) || 0,
    audioBitrate: Number(v.audioBitrate) || 0,
    isPassthrough: Boolean(v.isPassthrough),
  };
}

module.exports = definePlugin({
  onHttpRequest(req) {
    if (req.method === "GET" && req.path === "/admin/api/config") {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(owncast.videoConfig.read()),
      };
    }

    if (req.method === "POST" && req.path === "/admin/api/config") {
      let parsed;
      try {
        parsed = JSON.parse(req.body);
      } catch (e) {
        return { status: 400, body: "invalid JSON" };
      }

      // Build a partial VideoConfigUpdate: omit fields the form didn't
      // touch so unrelated knobs are left alone by the host.
      const update = {};
      if (parsed.latencyLevel !== undefined) {
        update.latencyLevel = Number(parsed.latencyLevel);
      }
      if (typeof parsed.codec === "string" && parsed.codec.length > 0) {
        update.codec = parsed.codec;
      }
      if (Array.isArray(parsed.variants)) {
        update.variants = parsed.variants.map(parseVariant);
      }

      try {
        owncast.videoConfig.write(update);
      } catch (e) {
        return { status: 400, body: String(e && e.message ? e.message : e) };
      }
      return { status: 204 };
    }

    return { status: 404 };
  },
});
