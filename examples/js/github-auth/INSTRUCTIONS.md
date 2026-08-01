# GitHub Auth

Requires viewers to sign in with GitHub before they can access your Owncast site.

## Setup

1. Register a GitHub OAuth app at https://github.com/settings/developers. Set the callback URL to `https://YOUR-OWNCAST/plugins/github-auth/callback`.
2. In **Admin → Plugins → GitHub Auth**, paste the **client ID** and **client secret** from that app.
3. On the **Authentication** tab, choose an access mode:
   - **Website only** is the default. It protects the website but leaves HLS players, `/api/status`, and Owncast Directory listing public.
   - **Website, video players, and other resources** also protects Owncast-hosted HLS. VLC and other players without a browser session cannot play the stream. `/api/status` and Directory listing stay public.
   - **Website, video players, and server status requests** also protects `/api/status` and disables Owncast Directory listing.
4. Enable the plugin. Viewers must sign in with GitHub before reaching a protected resource.

To turn the gate off again, disable the plugin.

## How it works

1. An unauthenticated visitor is sent to the plugin's login screen.
2. They click **Sign in with GitHub** and authorize your app on github.com.
3. GitHub redirects back to `/callback`. The plugin verifies the visitor, registers them as an authenticated Owncast user (their GitHub name becomes their chat display name), and grants a session.
4. The session is a signed cookie that Owncast issues and checks on every request, so the same login also identifies the viewer in chat.

Visiting `/plugins/github-auth/logout` clears the session.

## Permissions

- **auth.gate**: lets the plugin act as the site's authentication gate (issue and clear sessions).
- **users.register**: find-or-create the authenticated Owncast user for a GitHub identity.
- **http.serve**: serve the login screen and OAuth callback.
- **network.fetch**: talk to `github.com` and `api.github.com` to verify the user.
- **storage.kv**: hold the short-lived OAuth `state` value for CSRF protection.
