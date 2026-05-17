// stream-tracker — exercises every typed event and read API.
//
// On stream lifecycle / chat user activity, it persists a small running
// state in KV (when the stream started; who's currently in chat). When a
// viewer types !uptime, !who, or !server, it answers via owncast.chat.send
// — posting as the plugin's own bot ("stream-tracker") which the host
// provisions automatically. Action-style messages announce stream start /
// title changes.
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

function userList() {
  return JSON.parse(owncast.kv.get("users") || "[]");
}
function setUserList(users) {
  owncast.kv.set("users", JSON.stringify(users));
}

module.exports = definePlugin({
  // ── stream lifecycle ────────────────────────────────────────────────
  onStreamStarted(info) {
    owncast.kv.set("startedAt", info.startedAt || "");
    owncast.chat.sendAction(`is live: ${info.title || "stream"}`);
  },

  onStreamStopped(info) {
    owncast.kv.set("startedAt", "");
    owncast.chat.sendAction(`stream ended at ${info.stoppedAt || "now"}`);
  },

  onStreamTitleChanged(change) {
    owncast.chat.send(`title changed: "${change.from}" → "${change.to}"`);
  },

  // ── chat user lifecycle ─────────────────────────────────────────────
  onChatUserJoined(user) {
    const users = userList();
    if (!users.includes(user.displayName)) {
      users.push(user.displayName);
      setUserList(users);
    }
  },

  onChatUserParted(user) {
    setUserList(userList().filter(n => n !== user.displayName));
  },

  onChatUserRenamed(change) {
    setUserList(userList().map(n => n === change.previousName ? change.user.displayName : n));
  },

  // ── interactive commands ────────────────────────────────────────────
  onChatMessage(msg) {
    const body = msg.body.trim();
    if (body === "!uptime") {
      const state = owncast.stream.current();
      if (!state.online) {
        owncast.chat.send("stream is offline");
        return;
      }
      // "Now" is the moment the user asked, not wallclock.
      const askedAt = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
      const startedAt = state.startedAt ? new Date(state.startedAt).getTime() : askedAt;
      const seconds = Math.floor((askedAt - startedAt) / 1000);
      owncast.chat.send(`uptime: ${seconds}s, ${state.viewers} viewer(s) — "${state.title}"`);
      return;
    }
    if (body === "!who") {
      const users = userList();
      owncast.chat.send(users.length === 0
        ? "no one's here yet"
        : `in chat: ${users.join(", ")}`);
      return;
    }
    if (body === "!server") {
      const info = owncast.server.info();
      owncast.chat.send(`${info.name} v${info.version} — ${info.summary}`);
    }
  }
});
