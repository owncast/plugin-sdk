// tabs-demo: declares two viewer-page tabs in manifest.tabs and
// ships no host-side behavior. The host reads each tab's content file
// from the plugin's assets/ directory and inlines the HTML into the
// tab body on /api/config; the viewer page renders one tab per entry
// alongside the built-in Followers/About tabs.
const { definePlugin } = require("@owncast/plugin-sdk");
module.exports = definePlugin({});
