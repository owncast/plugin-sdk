// GitHub viewer-auth gate (JavaScript).
//
// The login flow is just a small HTTP app served under /plugins/github-auth/:
//
//   GET /          -> a "Sign in with GitHub" screen (the host redirects
//                     unauthenticated visitors here)
//   GET /callback  -> GitHub redirects back with ?code; we exchange it for a
//                     token, look up the user, then register the identity and
//                     grant a gate session
//   GET /logout    -> clear the session
//
// The host owns the signed session cookie end to end: owncast.auth.grantSession
// attaches it to the callback response, owncast.auth.endSession clears it. The
// plugin never sees the cookie or any access token.
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

module.exports = definePlugin({
  onHttpRequest(req) {
    const query = req.query || {};

    if (req.method === "GET" && req.path === "/") {
      // A real plugin generates a random `state` and persists it for CSRF; we
      // use a fixed value here to keep the example short.
      const returnTo = query.return_to || "/";
      const state = "demo-state";
      owncast.kv.set("oauth_state:" + state, returnTo);
      const params =
        "client_id=" +
        owncast.config.get("clientId", "") +
        "&scope=read:user&state=" +
        state;
      return {
        status: 200,
        headers: { "content-type": "text/html" },
        body:
          "<!doctype html><meta charset=utf-8><title>Sign in</title>" +
          "<h1>This stream is private</h1>" +
          '<a href="' +
          AUTHORIZE_URL +
          "?" +
          params +
          '">Sign in with GitHub</a>',
      };
    }

    if (req.method === "GET" && req.path === "/callback") {
      const code = query.code || "";
      const state = query.state || "";

      // CSRF: the state must match one we issued.
      const returnTo = owncast.kv.get("oauth_state:" + state);
      if (!returnTo) return { status: 400, body: "invalid or expired state" };
      owncast.kv.set("oauth_state:" + state, ""); // consume it

      // Exchange the code for an access token.
      const tokenResp = owncast.http.fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: owncast.config.get("clientId", ""),
          client_secret: owncast.config.get("clientSecret", ""),
          code,
        }),
      });
      const token = JSON.parse(tokenResp.body || "{}").access_token || "";

      // Look up the GitHub user behind the token.
      const userResp = owncast.http.fetch(USER_URL, {
        headers: {
          authorization: "Bearer " + token,
          accept: "application/json",
        },
      });
      const gh = JSON.parse(userResp.body || "{}");
      const authId = "github:" + gh.id;
      const display = gh.name || gh.login || authId;

      // Identity, then session. register() finds-or-creates the Owncast user
      // for this GitHub identity (the host namespaces authId by our slug); the
      // returned userId is what grantSession() issues the cookie for.
      const { userId } = owncast.users.register({ authId, displayName: display });
      owncast.auth.grantSession({ userId });

      return { status: 302, headers: { Location: returnTo || "/" } };
    }

    if (req.method === "GET" && req.path === "/logout") {
      owncast.auth.endSession();
      return { status: 302, headers: { Location: "/" } };
    }

    return { status: 404, body: "not found" };
  },
});
