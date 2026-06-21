from datetime import datetime

from owncast_plugin import plugin, filter

MIN_INTERVAL_MS = 2000

# Per-user last-post times held in plugin memory. The dict lives for the
# lifetime of the loaded wasm instance. Reloading or restarting the
# plugin resets the limiter, which is the right behavior for a soft
# slow-mode (no stale state across restarts).
last_by_user = {}


def _to_millis(timestamp):
    # Parse the host's ISO-8601 timestamp (e.g. "2024-01-01T00:00:00Z").
    text = timestamp.replace("Z", "+00:00")
    return int(datetime.fromisoformat(text).timestamp() * 1000)


@plugin.filter_chat_message
def slow_mode(msg):
    # Compare against the host's per-message timestamp. Key the limiter on
    # the stable user id, and show the display name in the drop reason.
    now = _to_millis(msg.timestamp)
    uid = msg.user.id if msg.user else "anon"
    name = msg.user.display_name if msg.user else uid
    last = last_by_user.get(uid, 0)
    if last > 0 and now - last < MIN_INTERVAL_MS:
        return filter.drop(
            f"slow-mode: {name} must wait {MIN_INTERVAL_MS}ms between messages"
        )
    last_by_user[uid] = now
    return filter.pass_()
