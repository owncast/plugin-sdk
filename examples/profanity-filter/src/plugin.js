const { definePlugin, filter } = require("@owncast/plugin-sdk");

const WORDLIST = ["damn", "hell", "crap"];

module.exports = definePlugin({
  filterChatMessage(msg) {
    let body = msg.body;
    let modified = false;
    for (const word of WORDLIST) {
      const re = new RegExp("\\b" + word + "\\b", "gi");
      if (re.test(body)) {
        body = body.replace(re, "*".repeat(word.length));
        modified = true;
      }
    }
    return modified
      ? filter.modify(Object.assign({}, msg, { body }))
      : filter.pass();
  }
});
