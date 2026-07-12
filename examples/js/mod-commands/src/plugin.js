const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const PING_COOLDOWN_MS = 30_000;

// Demonstrates the declarative command table:
//   - a custom prefix ("?" here instead of the default "!"), set with
//     commandPrefix,
//   - aliases (an alternate name that invokes the same command),
//   - a moderator-only command.
//
// Command names match case-insensitively by default, so "?PING" reaches ping.
// The bot needs only chat.send. Moderator access uses the sender's scopes, not
// their display name.
module.exports = definePlugin({
  commandPrefix: "?",


  // A regular chat handler remains independent from command dispatch.
  onChatMessage: (msg) => {
    if (msg.body && msg.body.startsWith("?")) {
      owncast.chat.system(`(command: ${msg.body})`);
    }
  },

  commands: {
    // Open to anyone. Proves the custom prefix is wired up, and "p" is an
    // alias so "?p" runs ping too.
    ping: {
      description: "Check the bot is alive",
      aliases: ["p"],
      cooldownMs: PING_COOLDOWN_MS,
      run: (ctx) => ctx.reply("pong"),
    },

    // Moderators only. Other invocations are silent.
    announce: {
      description: "Post an announcement (moderators only)",
      usage: "?announce <message>",
      modOnly: true,
      run: (ctx) => {
        const message = ctx.args.join(" ");
        ctx.reply(message ? `Announcement: ${message}` : "Usage: ?announce <message>");
      },
    },
  },
});
