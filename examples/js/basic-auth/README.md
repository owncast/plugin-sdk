# basic-auth

A shared-password viewer gate: visitors must enter one password before they can access the site. The simplest possible `auth.gate` plugin — no external identity provider, no network calls, no stored state. Everyone who enters the password shares a single authenticated identity ("Guest").

**Demonstrates:** the full auth-gate lifecycle — `owncast.users.register({ authId, displayName })` + `owncast.auth.grantSession({ userId })` to log a viewer in, `owncast.auth.endSession()` to log them out, and the `onAuthCheck` hook to **revoke** sessions: an admin-only `/revoke` route flips a flag, and `onAuthCheck` (run by the host on each page load) returns `deny` while it's set, bouncing every viewer back to the login screen. Compare with `github-auth`, which adds a real OAuth provider on top of the same primitives.

The host owns the signed session cookie end to end; the plugin only decides whether the password was right.
