const { definePlugin, owncast } = require("@owncast/plugin-sdk");

// Demonstrates the declarative command table:
//   - a custom prefix ("?" here instead of the default "!"), set with
//     commandPrefix,
//   - aliases (an alternate name that invokes the same command),
//   - a moderator-only command (the host checks the sender's scopes before
//     running a modOnly command, and everyone else is routed to onDenied), and
//   - onUnknownCommand, the fallback for a prefixed message that matches no
//     command in the table.
//
// Command names match case-insensitively by default, so "?PING" reaches ping.
// The bot needs only chat.send. Moderator gating is enforced by the host from
// the sender identity on the message, so the plugin never trusts a display name.
module.exports = definePlugin({
  commandPrefix: "?",

  // Fires when a "?"-prefixed message names a command not in the table.
  onUnknownCommand: (ctx) =>
    ctx.reply(`Unknown command "?${ctx.command}". Try ?ping.`),

  // You can define onChatMessage alongside commands. The SDK runs the command
  // router first, then calls this for every message, so both run. Here it posts
  // a system audit line whenever someone uses a "?" command.
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
      run: (ctx) => ctx.reply("pong"),
    },

    // Moderators only. A non-moderator who types ?announce hits onDenied.
    announce: {
      description: "Post an announcement (moderators only)",
      usage: "?announce <message>",
      modOnly: true,
      run: (ctx) => {
        const message = ctx.args.join(" ");
        ctx.reply(message ? `Announcement: ${message}` : "Usage: ?announce <message>");
      },
      onDenied: (ctx) => ctx.reply("Only moderators can use ?announce."),
    },
  },
});
