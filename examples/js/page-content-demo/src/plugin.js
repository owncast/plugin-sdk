// page-content-demo: demonstrates dynamic extraPageContent and viewer tabs.
//
// onPageContent — called by the host to render the "banner" slot.
//   Renders greeting.mustache, personalised with the viewer's display name.
//
// onTabContent — called by the host to render the "stream-info" tab.
//   Renders info.mustache with live stream, server, tags, socials, and
//   federation data read via server.read.
const { definePlugin, owncast } = require("@owncast/plugin-sdk");
const Mustache = require("mustache");

const templates = {};
function tpl(name) {
  if (!templates[name]) templates[name] = owncast.assets.readText(name);
  return templates[name];
}

module.exports = definePlugin({
  onPageContent({ slug, user }) {
    if (slug === "banner") {
      const displayName = (user && user.displayName) || "visitor";
      return Mustache.render(tpl("greeting.mustache"), { displayName });
    }
    return "";
  },

  onTabContent({ slug }) {
    if (slug === "stream-info") {
      const stream = owncast.stream.current();
      const server = owncast.server.info();
      const tags = owncast.server.tags();
      const socials = owncast.server.socials();
      const federation = owncast.server.federation();
      return Mustache.render(tpl("info.mustache"), {
        stream,
        server,
        tags,
        hasTags: tags.length > 0,
        socials,
        hasSocials: socials.length > 0,
        federation,
      });
    }
    return "";
  },
});
