# basic-auth

A shared-password viewer gate: visitors must enter one password before they can access the site. The simplest possible `auth.gate` plugin, with no external identity provider, no network calls, and no stored state. Everyone who enters the password shares a single authenticated identity ("Guest").

**Demonstrates:** the full auth-gate lifecycle. `owncast.users.register(auth_id, display_name=...)` + `owncast.auth.grant_session(user_id)` to log a viewer in, `owncast.auth.end_session()` to log them out, and the `on_auth_check` hook to **revoke** sessions: an admin-only `/revoke` route flips a flag, and `on_auth_check` (run by the host on each page load) returns `deny` while it's set, bouncing every viewer back to the login screen. Compare with `github-auth`, which adds a real OAuth provider on top of the same primitives.

The host owns the signed session cookie end to end. The plugin only decides whether the password was right.
