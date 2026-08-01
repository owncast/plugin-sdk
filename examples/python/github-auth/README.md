# github-auth

A viewer-authentication gate that makes visitors sign in with GitHub before they can access the site. The plugin is a small HTTP app: it shows a login screen, runs the GitHub OAuth flow, then registers the visitor as an authenticated Owncast user and grants them a gate session.

**Demonstrates:** the `auth.gate` permission and the viewer-auth host functions: `owncast.users.register(auth_id, display_name=..., profile_url=..., handle=..., public=False)` to find or create the authenticated user with verified profile metadata, `owncast.auth.grant_session(user_id)` to issue the session, and `owncast.auth.end_session()` to log out. The example keeps `public` false until its login UI offers an explicit visibility choice. It also uses `network.fetch` against `github.com` and `api.github.com`, plus `storage.kv` for the CSRF `state`.

The host owns the signed session cookie end to end. The plugin never sees the cookie or any access token. It only says "this visitor is identity X, give them a session," and Owncast does the rest.

The server admin selects a host-owned access mode on the **Authentication** tab:

- **Website only** is the default. It leaves Owncast-hosted HLS, `/api/status`, and Owncast Directory listing public.
- **Website, video players, and other resources** also requires authentication for Owncast-hosted HLS. VLC and other players without a browser session cannot play the stream, while `/api/status` and Directory listing stay public.
- **Website, video players, and server status requests** also requires authentication for `/api/status` and disables Owncast Directory listing.

The plugin cannot read or change that choice.
