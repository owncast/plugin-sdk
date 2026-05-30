// page-content-demo: declares an HTML file in
// manifest.extraPageContent and ships no host-side behavior. The
// host reads the file's bytes and prepends them to the admin's
// extraPageContent on /api/config, so the snippet shows up at the
// top of the viewer page's extra-content block.
const { definePlugin } = require("@owncast/plugin-sdk");
module.exports = definePlugin({});
