"""GitHub viewer-auth gate (Python).

The login flow is just a small HTTP app served under /plugins/github-auth/:

  GET /          -> a "Sign in with GitHub" screen (the host redirects
                    unauthenticated visitors here)
  GET /callback  -> GitHub redirects back with ?code; we exchange it for a
                    token, look up the user, then register the identity and
                    grant a gate session
  GET /logout    -> clear the session

The host owns the signed session cookie end to end: owncast.auth.grant_session
attaches it to the callback response, owncast.auth.end_session clears it. The
plugin never sees the cookie or any access token.
"""
import json

from owncast_plugin import plugin, owncast

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
USER_URL = "https://api.github.com/user"


def _query(req):
    return req.raw.get("query") or {}


@plugin.get("/")
def login(req):
    # A real plugin generates a random `state` and persists it for CSRF; we use
    # a fixed value here to keep the example short. The return_to is where we
    # send the viewer after a successful login.
    return_to = _query(req).get("return_to") or "/"
    state = "demo-state"
    owncast.kv.set("oauth_state:" + state, return_to)
    params = "client_id=%s&scope=read:user&state=%s" % (
        owncast.config.get("clientId", ""),
        state,
    )
    html = (
        "<!doctype html><meta charset=utf-8><title>Sign in</title>"
        '<h1>This stream is private</h1>'
        '<a href="%s?%s">Sign in with GitHub</a>' % (AUTHORIZE_URL, params)
    )
    return {"status": 200, "headers": {"content-type": "text/html"}, "body": html}


@plugin.get("/callback")
def callback(req):
    q = _query(req)
    code = q.get("code") or ""
    state = q.get("state") or ""

    # CSRF: the state must match one we issued.
    return_to = owncast.kv.get("oauth_state:" + state)
    if not return_to:
        return {"status": 400, "body": "invalid or expired state"}
    owncast.kv.set("oauth_state:" + state, "")  # consume it

    # Exchange the code for an access token.
    token_resp = owncast.http.fetch(
        TOKEN_URL,
        {
            "method": "POST",
            "headers": {
                "accept": "application/json",
                "content-type": "application/json",
            },
            "body": json.dumps(
                {
                    "client_id": owncast.config.get("clientId", ""),
                    "client_secret": owncast.config.get("clientSecret", ""),
                    "code": code,
                }
            ),
        },
    )
    token = json.loads(token_resp.body or "{}").get("access_token", "")

    # Look up the GitHub user behind the token.
    user_resp = owncast.http.fetch(
        USER_URL,
        {"headers": {"authorization": "Bearer " + token, "accept": "application/json"}},
    )
    gh = json.loads(user_resp.body or "{}")
    auth_id = "github:%s" % gh.get("id")
    display = gh.get("name") or gh.get("login") or auth_id

    # Identity, then session. register() finds-or-creates the Owncast user for
    # this GitHub identity (the host namespaces auth_id by our slug); the
    # returned user_id is what grant_session() issues the cookie for.
    result = owncast.users.register(auth_id, display_name=display)
    owncast.auth.grant_session(result.user_id)

    return {"status": 302, "headers": {"Location": return_to or "/"}}


@plugin.get("/logout")
def logout(req):
    owncast.auth.end_session()
    return {"status": 302, "headers": {"Location": "/"}}
