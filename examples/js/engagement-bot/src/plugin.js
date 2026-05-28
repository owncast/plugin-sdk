// engagement-bot: pipes Owncast events out to the streamer's other
// channels (Discord, browser push, fediverse). Exercises
// notifications.send (Discord + browser push), fediverse.post (the
// stream-start announcement), and chat.moderate (deleteMessage for the
// inline spam filter).
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const SPAM_KEYWORDS = ["buy crypto", "free money", "click here"];

module.exports = definePlugin({
  onChatMessage(msg) {
    const body = msg.body.toLowerCase();
    if (SPAM_KEYWORDS.some((k) => body.includes(k))) {
      owncast.chat.deleteMessage(msg.id);
    }
  },

  // When a stream starts, post to both Discord (subscribers' DMs) and to
  // the fediverse (the streamer's public follower base).
  onStreamStarted(info) {
    const title = info.title || "live now";
    owncast.notifications.discord(`Stream live: ${title}`);
    owncast.fediverse.post(`🔴 Going live: ${title}`);
  },

  // When someone follows the account on the fediverse, send a browser push
  // to subscribed clients.
  onFediverseFollow(event) {
    owncast.notifications.browserPush({
      title: "New follower",
      body: `${event.actor.handle} just followed`,
      url: event.actor.url,
    });
  },

  // Mentions and replies carry content; echo a short summary to Discord
  // so the streamer sees off-platform engagement in their normal channel.
  onFediverseMention(post) {
    const snippet =
      post.contentText.length > 200
        ? post.contentText.slice(0, 200) + "…"
        : post.contentText;
    owncast.notifications.discord(
      `mention from ${post.actor.handle}: ${snippet}\n${post.url}`,
    );
  },

  onFediverseReply(post) {
    const snippet =
      post.contentText.length > 200
        ? post.contentText.slice(0, 200) + "…"
        : post.contentText;
    owncast.notifications.discord(
      `reply from ${post.actor.handle}: ${snippet}\n${post.url}`,
    );
  },
});
