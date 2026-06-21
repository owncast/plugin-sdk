"""Basic password gate (Python).

The simplest auth.gate plugin: a single shared password. Everyone who knows it
shares one authenticated identity ("Guest"). No external provider.

  GET /              -> a password form (the host sends unauthenticated
                        visitors here)
  GET /login?password=...&return_to=...
                     -> correct password: register + grant a session, then
                        redirect back; wrong password: re-show the form
  GET /logout        -> clear the session
  GET /revoke        -> (admin only) revoke all sessions on next page load
  GET /unrevoke      -> (admin only) lift the revocation

on_auth_check re-validates the session on each page load: while "revoked" is
set, every viewer is bounced back to the login screen. This is the revocation
hook — a real provider-backed plugin would check per-user state here.
"""
from owncast_plugin import plugin, owncast, auth_check


def _escape_attr(s):
    return (
        str(s).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    )


def _page(return_to, message):
    return (
        "<!doctype html><meta charset=utf-8><title>Sign in</title>"
        "<h1>This stream is private</h1>"
        + ("<p>%s</p>" % message if message else "")
        + '<form method="GET" action="login">'
        + '<input type="hidden" name="return_to" value="%s">' % _escape_attr(return_to)
        + '<input type="password" name="password" placeholder="Password" autofocus>'
        + "<button type=\"submit\">Enter</button>"
        + "</form>"
    )


@plugin.get("/")
def login_form(req):
    return_to = (req.raw.get("query") or {}).get("return_to") or "/"
    return {
        "status": 200,
        "headers": {"content-type": "text/html"},
        "body": _page(return_to, ""),
    }


@plugin.get("/login")
def login(req):
    query = req.raw.get("query") or {}
    return_to = query.get("return_to") or "/"
    expected = owncast.config.get("password", "letmein")
    if (query.get("password") or "") != expected:
        return {
            "status": 200,
            "headers": {"content-type": "text/html"},
            "body": _page(return_to, "Incorrect password."),
        }
    # Everyone who knows the password shares one authenticated identity.
    result = owncast.users.register("shared", display_name="Guest")
    owncast.auth.grant_session(result.user_id)
    return {"status": 302, "headers": {"Location": return_to}}


@plugin.get("/logout")
def logout(req):
    owncast.auth.end_session()
    return {"status": 302, "headers": {"Location": "/"}}


@plugin.get("/revoke")
def revoke(req):
    # req.authenticated is true for admin requests; viewers can't flip it.
    if not req.authenticated:
        return {"status": 403, "body": "admin only"}
    owncast.kv.set("revoked", "1")
    return {"status": 200, "body": "revoked"}


@plugin.get("/unrevoke")
def unrevoke(req):
    if not req.authenticated:
        return {"status": 403, "body": "admin only"}
    owncast.kv.set("revoked", "")
    return {"status": 200, "body": "unrevoked"}


@plugin.on_auth_check
def auth_check_handler(_req):
    # Re-validate on each page load. While revoked, end every session.
    if owncast.kv.get("revoked") == "1":
        return auth_check.deny("access has been revoked")
    return auth_check.ok()
