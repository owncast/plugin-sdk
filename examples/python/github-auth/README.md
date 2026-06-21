# github-auth

A viewer-authentication gate that makes visitors sign in with GitHub before they can access the site. The plugin is a small HTTP app: it shows a login screen, runs the GitHub OAuth flow, then registers the visitor as an authenticated Owncast user and grants them a gate session.

**Demonstrates:** the `auth.gate` permission and the viewer-auth host functions — `owncast.users.register(auth_id, display_name=...)` to find-or-create the authenticated user, `owncast.auth.grant_session(user_id)` to issue the session, and `owncast.auth.end_session()` to log out. Also uses `network.fetch` (against `github.com` / `api.github.com`) and `storage.kv` (for the CSRF `state`).

The host owns the signed session cookie end to end. The plugin never sees the cookie or any access token. It only says "this visitor is identity X, give them a session," and Owncast does the rest.
