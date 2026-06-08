# stream-tracker, exercises every typed event and read API.
#
# On stream lifecycle / chat user activity, it persists a small running
# state in plugin config (when the stream started; who's currently in
# chat). When a viewer types !uptime, !who, or !server, it answers via
# owncast.chat.send, posting as the plugin's own bot ("stream-tracker")
# which the host provisions automatically. Action-style messages
# announce stream start / title changes.
import json
from datetime import datetime, timezone

from owncast_plugin import plugin, owncast


def user_list():
    return owncast.kv.get_json("users", []) or []


def set_user_list(users):
    # Compact JSON (no spaces) to match the host's JS-stringified form.
    owncast.kv.set("users", json.dumps(users, separators=(",", ":")))


def _epoch_ms(iso):
    """Parse an ISO-8601 timestamp into epoch milliseconds."""
    s = iso.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


# ── stream lifecycle ────────────────────────────────────────────────
@plugin.on_stream_started
def on_stream_started(info):
    owncast.kv.set("startedAt", info.started_at or "")
    # send_action prepends the bot name and renders /me-style, so phrase
    # the body so it reads like a sentence after "stream-tracker ".
    title = f": {info.title}" if info.title else ""
    owncast.chat.send_action(f"announces the stream is live{title}")


@plugin.on_stream_stopped
def on_stream_stopped(info):
    owncast.kv.set("startedAt", "")
    owncast.chat.send_action(f"stream ended at {info.stopped_at or 'now'}")


@plugin.on_stream_title_changed
def on_stream_title_changed(change):
    owncast.chat.send(f'title changed: "{change.from_}" → "{change.to}"')


# ── chat user lifecycle ─────────────────────────────────────────────
@plugin.on_chat_user_joined
def on_chat_user_joined(user):
    users = user_list()
    if user.display_name not in users:
        users.append(user.display_name)
        set_user_list(users)


@plugin.on_chat_user_parted
def on_chat_user_parted(user):
    set_user_list([n for n in user_list() if n != user.display_name])


@plugin.on_chat_user_renamed
def on_chat_user_renamed(change):
    set_user_list(
        [
            change.user.display_name if n == change.previous_name else n
            for n in user_list()
        ]
    )


# ── interactive commands ────────────────────────────────────────────
@plugin.on_chat_message
def on_chat_message(msg):
    body = msg.body.strip()
    if body == "!uptime":
        state = owncast.stream.current()
        if not state.online:
            owncast.chat.send("stream is offline")
            return
        # "Now" is the moment the user asked, not wallclock.
        asked_at = _epoch_ms(msg.timestamp) if msg.timestamp else 0
        started_at = _epoch_ms(state.started_at) if state.started_at else asked_at
        seconds = (asked_at - started_at) // 1000
        owncast.chat.send(
            f'uptime: {seconds}s, {state.viewers} viewer(s), "{state.title}"'
        )
        return
    if body == "!who":
        users = user_list()
        owncast.chat.send(
            "no one's here yet"
            if len(users) == 0
            else f"in chat: {', '.join(users)}"
        )
        return
    if body == "!server":
        info = owncast.server.info()
        owncast.chat.send(f"{info.name} v{info.version}, {info.summary}")
