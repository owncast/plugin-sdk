const { definePlugin, defineCommands, filter, owncast } = require("@owncast/plugin-sdk");

// The low-level command router. The mod-commands example uses the declarative
// `commands` table. This one calls defineCommands() directly, which hands back
// the router as a plain function you wire yourself. That lets you do things the
// table shorthand can't, shown here:
//
//   - case-sensitive matching (caseSensitive: true), so "!Shout" is NOT "!shout"
//   - per-user cooldowns with an onCooldown fallback
//   - private replies (replyPrivately), which whisper to the sender and fall
//     back to a public post when their connection isn't known
//
// The router returns true when a message was a command (even if gated or on
// cooldown), false otherwise. We use that return value inside filterChatMessage
// to drop recognized commands from public chat while letting everything else
// pass through untouched.
const commands = defineCommands({
  caseSensitive: true,
  commands: {
    shout: {
      description: "Repeat a message in all caps (once every 30s)",
      usage: "!shout <message>",
      cooldownMs: 30000,
      run: (ctx) => ctx.reply(`📢 ${ctx.argString.toUpperCase()}`),
      onCooldown: (ctx) => ctx.reply("Easy there, you can only shout every 30 seconds."),
    },
    secret: {
      description: "Whisper a secret only the sender can see",
      run: (ctx) => ctx.replyPrivately("The cake is a lie."),
    },
  },
});

module.exports = definePlugin({
  // chat.filter is required to subscribe to filterChatMessage. Recognized
  // commands are dropped so they never show up in public chat. Anything that
  // isn't a command passes through unchanged.
  filterChatMessage: (msg) =>
    commands(msg) ? filter.drop("handled as a command") : filter.pass(),
});
