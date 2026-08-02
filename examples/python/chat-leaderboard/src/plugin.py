from owncast_plugin import plugin, owncast

TOP_N = 5

# The plugin gets one private SQLite database. There is no init hook, so the
# schema is created on first use.
#
# Both statements go in a single exec call, which the host runs as one
# transaction: either the whole schema is there or none of it is. That is why a
# half-applied migration is not a state this plugin can end up in.
_schema_ready = False


def _ensure_schema():
    global _schema_ready
    if _schema_ready:
        return
    owncast.sql.exec(
        """
        CREATE TABLE IF NOT EXISTS chatters (
          user_id      TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          messages     INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS resets (
          reset_at TEXT NOT NULL
        );
        """
    )
    _schema_ready = True


# Count real chat, not command invocations, so !top does not inflate the score
# of whoever asked for it.
@plugin.on_chat_message
def _count(msg):
    body = msg.body or ""
    if not msg.user or body.startswith("!"):
        return
    _ensure_schema()

    # Keyed on the stable user id. The display name is stored alongside it and
    # refreshed on every message, so a rename shows up in the standings without
    # splitting anyone's history. `excluded` is the row the INSERT tried to add.
    owncast.sql.exec(
        """
        INSERT INTO chatters (user_id, display_name, messages) VALUES (?, ?, 1)
        ON CONFLICT (user_id) DO UPDATE SET
          messages = messages + 1,
          display_name = excluded.display_name
        """,
        [msg.user.id, msg.user.display_name or "someone"],
    )


def _top(ctx):
    _ensure_schema()
    # Ranking is the reason this plugin uses SQL rather than the key-value
    # store: the database does the sorting, and only the rows that will be shown
    # cross into the plugin.
    #
    # The LIMIT is not optional. An unbounded query over a table that grows with
    # your audience is refused by the host rather than quietly truncated, so
    # write the bound you actually want.
    rows = owncast.sql.query(
        """
        SELECT display_name, messages FROM chatters
        ORDER BY messages DESC, display_name ASC, user_id ASC
        LIMIT ?
        """,
        [TOP_N],
    )
    if not rows:
        ctx.reply("No messages counted yet.")
        return
    standings = ", ".join(
        f"{i + 1}. {row['display_name']} ({row['messages']})"
        for i, row in enumerate(rows)
    )
    ctx.reply(f"Top chatters: {standings}")


def _rank(ctx):
    _ensure_schema()
    user_id = ctx.user.id if ctx.user else ""
    # query_row asks the host for a single row, so this stays cheap no matter how
    # many chatters the table holds. It returns None when nothing matches, which
    # here means the sender has not been counted yet.
    row = owncast.sql.query_row(
        """
        SELECT mine.display_name,
               mine.messages,
               (SELECT count(*) FROM chatters AS other
                 WHERE other.messages > mine.messages
                    OR (other.messages = mine.messages AND other.display_name < mine.display_name)
                    OR (other.messages = mine.messages AND other.display_name = mine.display_name AND other.user_id < mine.user_id)) + 1 AS position
          FROM chatters AS mine
         WHERE mine.user_id = ?
        """,
        [user_id],
    )
    if not row:
        ctx.reply("You have not sent any messages yet.")
        return
    ctx.reply(
        f"{row['display_name']} is #{row['position']} "
        f"with {row['messages']} message(s)."
    )


def _reset(ctx):
    _ensure_schema()
    # Two statements, one exec, one transaction. The audit row cannot be written
    # without the standings being cleared, and the standings cannot be cleared
    # without the audit row.
    owncast.sql.exec(
        """
        DELETE FROM chatters;
        INSERT INTO resets (reset_at) VALUES (datetime('now'))
        """
    )
    total = owncast.sql.query_row("SELECT count(*) AS resets FROM resets")
    ctx.reply(f"Leaderboard cleared. Times reset: {total['resets']}.")


plugin.commands({
    "top": {
        "description": "Show the most active chatters",
        "run": _top,
    },
    "rank": {
        "description": "Show your own position on the leaderboard",
        "run": _rank,
    },
    "resetleaderboard": {
        "description": "Clear the leaderboard (moderators only)",
        "mod_only": True,
        "run": _reset,
    },
})
