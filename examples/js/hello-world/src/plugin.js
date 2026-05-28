// hello-world plugin: no event handlers, just proves the load + register()
// path works end-to-end. definePlugin({}) is optional when there are zero
// handlers, but we call it for shape consistency.
const { definePlugin } = require("@owncast/plugin-sdk");
module.exports = definePlugin({});
