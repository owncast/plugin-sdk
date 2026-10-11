from owncast_plugin import plugin, owncast

PUBLIC = "https://www.w3.org/ns/activitystreams#Public"


def _has_public_recipient(value):
    return PUBLIC in value if isinstance(value, list) else value == PUBLIC


def _has_public_audience(activity, obj):
    activity_has_audience = "to" in activity or "cc" in activity
    object_has_audience = "to" in obj or "cc" in obj
    return (
        (activity_has_audience or object_has_audience)
        and (
            not activity_has_audience
            or _has_public_recipient(activity.get("to"))
            or _has_public_recipient(activity.get("cc"))
        )
        and (
            not object_has_audience
            or _has_public_recipient(obj.get("to"))
            or _has_public_recipient(obj.get("cc"))
        )
    )


@plugin.on_fediverse_outbound
def observe(activity):
    raw = activity.raw
    if raw.get("type") != "Create":
        return
    activity_object = raw.get("object")
    if (
        not isinstance(activity_object, dict)
        or activity_object.get("type") != "Note"
    ):
        return
    if not _has_public_audience(raw, activity_object):
        return
    owncast.chat.send("Observed a public Fediverse post.")
