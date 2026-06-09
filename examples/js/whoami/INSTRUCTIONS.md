# Who Am I

Shows how Owncast hands a plugin the identity of the logged-in chat user, with no token handling on the plugin's part. It's mostly a developer demo, but you can see it in action directly.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. As a viewer, **join the chat** (so Owncast issues you a chat identity).
3. Click the **Who am I?** action button on the viewer page (or open **`/plugins/whoami/`**).
4. The page shows the chat identity Owncast resolved for you. If you haven't joined chat, it reports that you're not identified.

The plugin never sees a raw token — Owncast resolves your chat cookie server-side and passes the resolved user to the plugin's request handler.

## Permissions

- **ui.modify** — adds the "Who am I?" action button.
- **http.serve** — serves the page and its identity endpoint.

No chat or storage permission is needed; the plugin only reports what the host already gives it.
