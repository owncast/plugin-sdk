const { definePlugin, owncast } = require("@owncast/plugin-sdk");

// A chat bot that shows the two ways a plugin does time-based work. The wasm
// sandbox has no setTimeout, so:
//   - owncast.timer.setTimeout / setInterval / clear schedule callbacks the
//     host runs later (only active while scheduled), and
//   - onTick fires once a second for open-ended periodic work.
//
// State lives in the long-lived instance, so it persists between calls. Our
// own replies don't start with "!", so onChatMessage never reacts to them.
let reminderId = null;
let intervalId = null;
let countdown = 0;

function say(text) {
  owncast.chat.send(text);
}

module.exports = definePlugin({
  onChatMessage(msg) {
    const body = (msg.body || "").trim();
    if (body[0] !== "!") return;
    const parts = body.split(/\s+/);
    const cmd = parts[0];

    // !remind <seconds> <message> — send the message once, later (setTimeout).
    if (cmd === "!remind") {
      const seconds = parseInt(parts[1], 10);
      const message = parts.slice(2).join(" ");
      if (!seconds || !message) {
        say("Usage: !remind <seconds> <message>");
        return;
      }
      reminderId = owncast.timer.setTimeout(
        () => say(`@${msg.user} reminder: ${message}`),
        seconds * 1000,
      );
      say(`Reminder set: ${seconds}s`);
      return;
    }

    // !every <seconds> <message> — repeat until !stop (setInterval). One at a
    // time for this demo.
    if (cmd === "!every") {
      const seconds = parseInt(parts[1], 10);
      const message = parts.slice(2).join(" ");
      if (!seconds || !message) {
        say("Usage: !every <seconds> <message>");
        return;
      }
      if (intervalId !== null) owncast.timer.clear(intervalId);
      intervalId = owncast.timer.setInterval(() => say(message), seconds * 1000);
      say(`Repeating every ${seconds}s (send !stop to end)`);
      return;
    }

    // !countdown <seconds> — count down live, one number a second, using the
    // tick event instead of a timer.
    if (cmd === "!countdown") {
      const seconds = parseInt(parts[1], 10);
      if (!seconds) {
        say("Usage: !countdown <seconds>");
        return;
      }
      countdown = seconds;
      say(`Counting down from ${seconds}`);
      return;
    }

    // !stop — cancel the repeater, any pending reminder, and the countdown.
    if (cmd === "!stop") {
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
      return;
    }
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
