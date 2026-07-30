const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const TOP_N = 5;

// The plugin gets one private SQLite database. There is no init hook, so the
// schema is created on first use.
//
// Both statements go in a single exec call, which the host runs as one
// transaction: either the whole schema is there or none of it is. That is why a
// half-applied migration is not a state this plugin can end up in.
let schemaReady = false;

function ensureSchema() {
  if (schemaReady) return;
  owncast.sql.exec(`
    CREATE TABLE IF NOT EXISTS chatters (
      user_id      TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      messages     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS resets (
      reset_at TEXT NOT NULL
    );
  `);
  schemaReady = true;
}

module.exports = definePlugin({
  // Count real chat, not command invocations, so `!top` does not inflate the
  // score of whoever asked for it.
  onChatMessage(msg) {
    const body = msg.body || "";
    if (!msg.user || body.startsWith("!")) return;
    ensureSchema();

    // Keyed on the stable user id. The display name is stored alongside it and
    // refreshed on every message, so a rename shows up in the standings without
    // splitting anyone's history. `excluded` is the row the INSERT tried to add.
    owncast.sql.exec(
      `INSERT INTO chatters (user_id, display_name, messages) VALUES (?, ?, 1)
       ON CONFLICT (user_id) DO UPDATE SET
         messages = messages + 1,
         display_name = excluded.display_name`,
      [msg.user.id, msg.user.displayName || "someone"],
    );
  },

  commands: {
    top: {
      description: "Show the most active chatters",
      run(ctx) {
        ensureSchema();
        // Ranking is the reason this plugin uses SQL rather than the key-value
        // store: the database does the sorting, and only the rows that will be
        // shown cross into the plugin.
        //
        // The LIMIT is not optional. An unbounded query over a table that grows
        // with your audience is refused by the host rather than quietly
        // truncated, so write the bound you actually want.
        const rows = owncast.sql.query(
          `SELECT display_name, messages FROM chatters
           ORDER BY messages DESC, display_name ASC, user_id ASC
           LIMIT ?`,
          [TOP_N],
        );
        if (rows.length === 0) {
          ctx.reply("No messages counted yet.");
          return;
        }
        const standings = rows
          .map((row, i) => `${i + 1}. ${row.display_name} (${row.messages})`)
          .join(", ");
        ctx.reply(`Top chatters: ${standings}`);
      },
    },

    rank: {
      description: "Show your own position on the leaderboard",
      run(ctx) {
        ensureSchema();
        const userId = ctx.user ? ctx.user.id : "";
        // queryRow asks the host for a single row, so this stays cheap no matter
        // how many chatters the table holds. It returns null when nothing
        // matches, which here means the sender has not been counted yet.
        const row = owncast.sql.queryRow(
          `SELECT mine.display_name,
                  mine.messages,
                  (SELECT count(*) FROM chatters AS other
                    WHERE other.messages > mine.messages
                       OR (other.messages = mine.messages AND other.display_name < mine.display_name)
                       OR (other.messages = mine.messages AND other.display_name = mine.display_name AND other.user_id < mine.user_id)) + 1 AS position
             FROM chatters AS mine
            WHERE mine.user_id = ?`,
          [userId],
        );
        if (!row) {
          ctx.reply("You have not sent any messages yet.");
          return;
        }
        ctx.reply(`${row.display_name} is #${row.position} with ${row.messages} message(s).`);
      },
    },

    resetleaderboard: {
      description: "Clear the leaderboard (moderators only)",
      modOnly: true,
      run(ctx) {
        ensureSchema();
        // Two statements, one exec, one transaction. The audit row cannot be
        // written without the standings being cleared, and the standings cannot
        // be cleared without the audit row.
        owncast.sql.exec(
          `DELETE FROM chatters;
           INSERT INTO resets (reset_at) VALUES (datetime('now'))`,
        );
        const total = owncast.sql.queryRow("SELECT count(*) AS resets FROM resets");
        ctx.reply(`Leaderboard cleared. Times reset: ${total.resets}.`);
      },
    },
  },
});
