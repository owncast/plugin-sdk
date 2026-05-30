// viewer-gate: ships a CSS file and a JavaScript file. The CSS
// styles the confirmation modal; the JS builds the modal DOM on
// page load and wires the buttons. No host-side behavior (no chat
// hooks, no admin pages); the manifest's permission set is just
// what the host needs to inject the assets.
const { definePlugin } = require("@owncast/plugin-sdk");
module.exports = definePlugin({});
