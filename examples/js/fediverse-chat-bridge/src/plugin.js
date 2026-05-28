// fediverse-chat-bridge: when someone mentions or replies to the streamer
// on the fediverse, surface it in chat as a system message that includes
// the poster's avatar, display name, handle (linked to their profile),
// and the post text (linked to the original).

const { definePlugin, owncast } = require("@owncast/plugin-sdk");

// Anything coming from a remote fediverse server is untrusted text; the
// system-message body is rendered as HTML, so escape everything that lands
// in attribute values or text nodes before inserting it.
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow http(s) URLs through unescaped, defense against javascript:
// and data: URLs sneaking into href/src attributes.
function safeUrl(u) {
  const s = String(u == null ? "" : u);
  return /^https?:\/\//i.test(s) ? s : "";
}

function renderPost(post) {
  const actor = post.actor || {};
  const avatar = safeUrl(actor.image);
  const profile = safeUrl(actor.url);
  const permalink = safeUrl(post.url);
  const name = escapeHtml(actor.name || actor.handle || "Someone");
  const handle = escapeHtml(actor.handle || "");
  const text = escapeHtml(post.contentText || "");

  const avatarHtml = avatar
    ? `<img src="${escapeHtml(avatar)}" alt="" width="32" height="32" style="vertical-align:middle;border-radius:50%;margin-right:8px">`
    : "";
  const nameHtml = profile
    ? `<a href="${escapeHtml(profile)}" rel="noopener noreferrer">${name}</a>`
    : name;
  const handleHtml = handle
    ? ` <span style="opacity:0.7">${handle}</span>`
    : "";
  const textHtml = permalink
    ? `, <a href="${escapeHtml(permalink)}" rel="noopener noreferrer">${text}</a>`
    : `, ${text}`;

  return `${avatarHtml}<strong>${nameHtml}</strong>${handleHtml}${textHtml}`;
}

module.exports = definePlugin({
  onFediverseMention(post) {
    owncast.chat.system(renderPost(post));
  },
  onFediverseReply(post) {
    owncast.chat.system(renderPost(post));
  },
});
