# action-buttons: contributes viewer action buttons via the manifest AND
# ships an admin page that lets the streamer add a custom button on top
# of those defaults. Demonstrates two integrations at once:
#
#   - UI updates: owncast.actions.add(buttons) appends to the plugin's
#     effective list. The viewer chrome picks up the new entries on the
#     next /api/config response without a plugin reload.
#
#   - Custom API: the admin page (public/admin/index.html) talks to
#     /admin/api/custom-button (a plugin-owned endpoint) which
#     persists the streamer's input to the plugin's config and pushes
#     it through to the host. Auth gating on /admin/* comes from the
#     host.
import json

from owncast_plugin import plugin, owncast

# Key the plugin owns inside its own config to remember the streamer's
# custom button between requests. Distinct from the host-reserved
# `owncast.actions` key the SDK manages internally.
CUSTOM_BUTTON_KEY = "custom-button"


def load_custom_button():
    raw = owncast.kv.get(CUSTOM_BUTTON_KEY)
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    if (
        isinstance(parsed, dict)
        and isinstance(parsed.get("title"), str)
        and isinstance(parsed.get("url"), str)
    ):
        return parsed
    return None


# Re-publish the saved button (if any) into the host's runtime list.
# Called on POST after a save and on the GET fetch so the host stays
# in sync with whatever the plugin has remembered.
def publish_custom_button():
    owncast.actions.clear()
    button = load_custom_button()
    if button:
        owncast.actions.add(
            {
                "title": button["title"],
                "url": button["url"],
                "description": "Added at runtime from the action-buttons admin page",
                "openExternally": True,
            }
        )


@plugin.get("/admin/api/custom-button")
def get_custom_button(req):
    # Reflect the host's runtime state back to the form on every load
    # so what the admin sees matches what viewers see.
    publish_custom_button()
    return {
        "status": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(load_custom_button() or {"title": "", "url": ""}),
    }


@plugin.post("/admin/api/custom-button")
def save_custom_button(req):
    try:
        payload = json.loads(req.body)
    except ValueError:
        return {"status": 400, "body": "invalid JSON"}
    title = payload.get("title").strip() if isinstance(payload, dict) and isinstance(payload.get("title"), str) else ""
    url = payload.get("url").strip() if isinstance(payload, dict) and isinstance(payload.get("url"), str) else ""
    if not title and not url:
        owncast.kv.delete(CUSTOM_BUTTON_KEY)
        # Older SDK versions may not expose kv.delete, so just overwrite
        # with an empty value so load_custom_button returns None.
        owncast.kv.set(CUSTOM_BUTTON_KEY, "")
        owncast.actions.clear()
        return {
            "status": 200,
            "headers": {"content-type": "application/json"},
            "body": json.dumps({"title": "", "url": ""}),
        }
    if not title or not url:
        return {"status": 400, "body": "both title and url are required"}
    owncast.kv.set(CUSTOM_BUTTON_KEY, json.dumps({"title": title, "url": url}))
    publish_custom_button()
    return {
        "status": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"title": title, "url": url}),
    }
