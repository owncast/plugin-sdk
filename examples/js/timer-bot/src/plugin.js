const { definePlugin, owncast } = require("@owncast/plugin-sdk");

// A chat bot that shows the two ways a plugin does time-based work. The wasm
// sandbox has no setTimeout, so:
//   - owncast.timer.setTimeout / setInterval / clear schedule callbacks the
//     host runs later (only active while scheduled), and
//   - onTick fires once a second for open-ended periodic work.
//
// Commands are declared with definePlugin's `commands` table (the SDK wires the
// chat subscription — no onChatMessage). State lives in the long-lived
// instance, so it persists between calls. Our own replies don't start with "!",
// so the router never reacts to them.
let reminderId = null;
let intervalId = null;
let countdown = 0;

function say(text) {
  owncast.chat.send(text);
}

module.exports = definePlugin({
  commands: {
    // !remind <seconds> <message> — send the message once, later (setTimeout).
    remind: {
      description: "Remind you with a message after N seconds",
      usage: "!remind <seconds> <message>",
      run: (ctx) => {
        const seconds = parseInt(ctx.args[0], 10);
        const message = ctx.args.slice(1).join(" ");
        if (!seconds || !message) {
          say("Usage: !remind <seconds> <message>");
          return;
        }
        const who = ctx.msg.user ? ctx.msg.user.displayName : "you";
        reminderId = owncast.timer.setTimeout(
          () => say(`@${who} reminder: ${message}`),
          seconds * 1000,
        );
        say(`Reminder set: ${seconds}s`);
      },
    },

    // !every <seconds> <message> — repeat until !stop (setInterval). One at a
    // time for this demo.
    every: {
      description: "Repeat a message every N seconds until !stop",
      usage: "!every <seconds> <message>",
      run: (ctx) => {
        const seconds = parseInt(ctx.args[0], 10);
        const message = ctx.args.slice(1).join(" ");
        if (!seconds || !message) {
          say("Usage: !every <seconds> <message>");
          return;
        }
        if (intervalId !== null) owncast.timer.clear(intervalId);
        intervalId = owncast.timer.setInterval(
          () => say(message),
          seconds * 1000,
        );
        say(`Repeating every ${seconds}s (send !stop to end)`);
      },
    },

    // !countdown <seconds> — count down live, one number a second, using the
    // tick event instead of a timer.
    countdown: {
      description: "Count down live from N seconds (driven by onTick)",
      usage: "!countdown <seconds>",
      run: (ctx) => {
        const seconds = parseInt(ctx.args[0], 10);
        if (!seconds) {
          say("Usage: !countdown <seconds>");
          return;
        }
        countdown = seconds;
        say(`Counting down from ${seconds}`);
      },
    },

    // !stop — cancel the repeater, any pending reminder, and the countdown.
    stop: {
      description: "Cancel the repeater, pending reminder, and countdown",
      run: () => {
        if (intervalId !== null) {
          owncast.timer.clear(intervalId);
          intervalId = null;
        }
        if (reminderId !== null) {
          owncast.timer.clear(reminderId);
          reminderId = null;
        }
        countdown = 0;
        say("Stopped");
      },
    },
  },

  // Fires once a second while the plugin is enabled. Drives the live countdown;
  // does nothing the rest of the time. `now` is the host wall-clock time in ms.
  onTick() {
    if (countdown <= 0) return;
    say(String(countdown));
    countdown--;
    if (countdown === 0) say("Go!");
  },
});
