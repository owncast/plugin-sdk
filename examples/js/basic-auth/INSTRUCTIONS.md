# Basic Auth

Requires viewers to enter a shared password before they can access your Owncast site.

## Setup

1. In **Admin → Plugins → Basic Auth**, set the **password** you want to hand out to viewers (default: `letmein` — change it).
2. Enable the plugin. While it is enabled, every viewer must enter the password first.

To turn the gate off again, disable the plugin.

## How it works

1. An unauthenticated visitor is sent to the plugin's password form.
2. They enter the password and submit.
3. On a match, the plugin logs them in (everyone shares one "Guest" identity) and grants a session — a signed cookie Owncast sets and checks on every request.
4. Visiting `/plugins/basic-auth/logout` clears the session.

**Revoking everyone:** if you change the password or just want to force everyone back to the login screen, an admin can hit `/plugins/basic-auth/revoke` (and later `/plugins/basic-auth/unrevoke`). While revoked, the next time any viewer loads the page they're signed out. This uses the `onAuthCheck` hook, which the host runs on each page load to re-validate sessions.

This is the simplest kind of gate. For per-person identities, use an auth plugin backed by a real provider (see `github-auth`).

## Permissions

- **auth.gate** — lets the plugin act as the site's authentication gate (issue, clear, and re-validate sessions).
- **users.register** — create the authenticated Owncast user a session is granted to.
- **http.serve** — serve the password form and the login/logout/revoke routes.
- **storage.kv** — remember the "revoked" flag that `onAuthCheck` consults.
