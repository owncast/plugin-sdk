// styles-demo: declares a CSS file in manifest.styles and ships no
// behavior. The host validator rewrites the relative path into
// /plugins/styles-demo/theme.css; the viewer page <link>-injects that
// URL on load. Useful as the simplest possible demonstration that
// plugin-supplied CSS reaches the viewer's global scope.
const { definePlugin } = require("@owncast/plugin-sdk");
module.exports = definePlugin({});
