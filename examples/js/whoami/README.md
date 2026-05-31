# Who Am I

A small example that shows how Owncast passes the logged-in chat user to a
plugin's HTTP handlers. The plugin author does not have to look the user up or
handle any tokens.

## How it works

1. When a viewer registers or connects to chat, Owncast sets a chat identity
   cookie (`owncast_chat_token`) on its own origin.
2. This plugin declares a viewer action button ("Who am I?") that opens the
   plugin's page at `/plugins/whoami/`.
3. The browser sends the identity cookie with that request.
4. Owncast resolves the cookie to the user on the server and gives the handler
   an optional `req.user`. The plugin never sees the raw token.
5. The page fetches `./api/me`, which returns `req.user`, and renders it.

Because the host does the lookup, `req.user` is either present (the visitor is
a known chat user) or missing (`undefined`, when they haven't joined chat). The
handler checks for it:

```js
onHttpRequest(req) {
  if (req.method === "GET" && req.path === "/api/me") {
    if (!req.user) return { status: 401, /* ... */ };
    return { status: 200, body: JSON.stringify({ identified: true, user: req.user }) };
  }
  return { status: 404, body: "not found" };
}
```

## Permissions

- `ui.modify` adds the viewer action button.
- `http.serve` serves the page and the `/api/me` endpoint.

No chat or storage permission is needed. The plugin only reports what the host
already gives it.

## Run it

```bash
npm install
npm test        # build and run the tests
npm run serve   # build and serve at http://localhost:8080/plugins/whoami/
```

The local dev server has no chat user database, so to see the populated case
pass a fake identity with a header:

```bash
curl -H "Authorization: Bearer user:alice" http://localhost:8080/plugins/whoami/api/me
```

In a real Owncast install the identity comes from the chat cookie, so no header
or query parameter is needed.
