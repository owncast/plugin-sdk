// Always throws, exists to verify the host's fail-open behavior in the
// filter chain. A real plugin should never look like this.
const { definePlugin } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  filterChatMessage() {
    throw new Error("intentional failure for fail-open testing");
  },
});
