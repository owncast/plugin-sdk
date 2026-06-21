// Basic password gate (JavaScript).
//
// The simplest auth.gate plugin: a single shared password. Everyone who knows
// it shares one authenticated identity ("Guest"). No external provider.
//
//   GET /              -> a password form (the host sends unauthenticated
//                         visitors here)
//   GET /login?password=...&return_to=...
//                      -> correct password: register + grant a session, then
//                         redirect back; wrong password: re-show the form
//   GET /logout        -> clear the session
//   GET /revoke        -> (admin only) revoke all sessions on next page load
//   GET /unrevoke      -> (admin only) lift the revocation
//
// onAuthCheck re-validates the session on each page load: while "revoked" is
// set, every viewer is bounced back to the login screen. This is the revocation
// hook — a real provider-backed plugin would check per-user state here.
const { definePlugin, owncast, authCheck } = require("@owncast/plugin-sdk");

function page(returnTo, message) {
  return (
    "<!doctype html><meta charset=utf-8><title>Sign in</title>" +
    "<h1>This stream is private</h1>" +
    (message ? "<p>" + message + "</p>" : "") +
    '<form method="GET" action="login">' +
    '<input type="hidden" name="return_to" value="' + escapeAttr(returnTo) + '">' +
    '<input type="password" name="password" placeholder="Password" autofocus>' +
    "<button type=\"submit\">Enter</button>" +
    "</form>"
  );
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

module.exports = definePlugin({
  onHttpRequest(req) {
    const query = req.query || {};
    const returnTo = query.return_to || "/";

    if (req.method === "GET" && req.path === "/") {
      return { status: 200, headers: { "content-type": "text/html" }, body: page(returnTo, "") };
    }

    if (req.path === "/login") {
      const expected = owncast.config.get("password", "letmein");
      if ((query.password || "") !== expected) {
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: page(returnTo, "Incorrect password."),
        };
      }
      // Everyone who knows the password shares one authenticated identity.
      const { userId } = owncast.users.register({ authId: "shared", displayName: "Guest" });
      owncast.auth.grantSession({ userId });
      return { status: 302, headers: { Location: returnTo } };
    }

    if (req.path === "/logout") {
      owncast.auth.endSession();
      return { status: 302, headers: { Location: "/" } };
    }

    // Admin-only revocation toggle. req.authenticated is true for admin
    // requests (Basic auth / admin session); viewers can't flip it.
    if (req.path === "/revoke" || req.path === "/unrevoke") {
      if (!req.authenticated) return { status: 403, body: "admin only" };
      owncast.kv.set("revoked", req.path === "/revoke" ? "1" : "");
      return { status: 200, body: req.path === "/revoke" ? "revoked" : "unrevoked" };
    }

    return { status: 404, body: "not found" };
  },

  // Re-validate on each page load. While revoked, end every session.
  onAuthCheck(_req) {
    if (owncast.kv.get("revoked") === "1") {
      return authCheck.deny("access has been revoked");
    }
    return authCheck.ok();
  },
});
