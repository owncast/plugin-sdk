# owncast-plugin-sdk (Python)

SDK for authoring [Owncast](https://owncast.online) plugins in **Python**. Plugins compile to WebAssembly and run sandboxed inside the Owncast server — the same runtime, wire protocol, and `.ocpkg` format as the [JavaScript SDK](../js), so a Python plugin is a first-class peer of a JS one.

You write ordinary Python with decorators; a build step inlines this runtime plus your code and compiles it to wasm with [`extism-py`](https://github.com/extism/python-pdk).

> ### ⚠️ Python plugins are big: ~11 MB vs ~2.4 MB for JavaScript
>
> A compiled Python plugin embeds the **entire CPython interpreter**, so the `.wasm` is about **11 MB** — versus **~2.4 MB** for the equivalent JavaScript plugin (which embeds the much smaller QuickJS engine). That's roughly **4.7× larger / ~8.5 MB more**, and it's **fixed overhead**: a one-line "hello world" Python plugin is already ~11 MB, because the size is dominated by the bundled runtime, not your code.
>
> | | JavaScript | Python |
> |---|---|---|
> | embedded engine | QuickJS | CPython |
> | typical plugin `.wasm` | ~2.4 MB | ~11 MB |
> | minimal ("hello world") | ~2.4 MB | ~11 MB |
>
> This affects download/install size and cold-start, not steady-state behavior (the host caps plugin memory at 64 MiB and reuses the instance across calls). If a few extra megabytes per plugin matter for your deployment, prefer the [JavaScript SDK](../js); otherwise write in whichever language you're happiest in.

## Quick start

The Python SDK doesn't yet have a published package, scaffolder, or one-shot CLI (those are on the roadmap — see [Status](#status)). For now you build with the bundled tool. You need three things on your machine:

- **[`extism-py`](https://github.com/extism/python-pdk)** — the Python→wasm compiler.
- **binaryen** (`wasm-merge`, `wasm-opt`) — on your `PATH`; `extism-py` shells out to them.
- **`owncast-plugin-test` / `owncast-plugin-serve`** — the host test/dev-server binaries (the same ones the JS SDK downloads; grab them from this repo's [releases](https://github.com/owncast/plugin-sdk/releases)).

A plugin is a directory:

```
my-plugin/
├── plugin.manifest.json     # name, slug, version, permissions
├── src/plugin.py            # your code
└── __tests__/*.test.json    # optional scenario tests
```

Build and test:

```sh
# compile src/plugin.py -> <slug>.wasm
python3 path/to/sdks/python/owncast_plugin_build.py my-plugin

# run the scenario tests in __tests__/
owncast-plugin-test my-plugin

# run a local dev server (POST /_dev/chat to drive it)
owncast-plugin-serve my-plugin

# the <slug>.wasm + plugin.manifest.json (+ public/, assets/, icon.png) are
# what you ship; zip them into a <slug>.ocpkg to install in Owncast.
```

Install in Owncast from the admin **Plugins** page (**Upload plugin**) or by copying the package to the server's `data/plugins/` directory, then toggle **Enabled**.

## Writing a plugin

Import `plugin`, `owncast`, and `filter`, and register handlers with decorators:

```python
from owncast_plugin import plugin, owncast, filter


@plugin.on_chat_message
def greet(msg):
    owncast.chat.send(f"echo: {msg.body}")


@plugin.filter_chat_message
def block_spam(msg):
    return filter.drop("spam") if "spam" in msg.body else filter.pass_()
```

Declare the permissions you use (`chat.send` above) in `plugin.manifest.json`. The build only wires up the host functions your permissions grant.

### Event handlers

Each decorator subscribes to one event; the SDK derives the manifest subscriptions from which handlers you define.

| Decorator | Fires on |
|---|---|
| `@plugin.on_chat_message` | a chat message (notify) |
| `@plugin.filter_chat_message` | a chat message, **before broadcast** — return a `filter` result (requires `chat.filter`) |
| `@plugin.on_chat_user_joined` / `_parted` / `_renamed` | chat presence |
| `@plugin.on_message_moderated` | a message hidden/restored |
| `@plugin.on_stream_started` / `_stopped` / `_title_changed` | stream lifecycle |
| `@plugin.on_sse_connect` / `_disconnect` | a viewer's SSE stream opened/closed |
| `@plugin.on_tick` | ~once per second |
| `@plugin.on_fediverse_follow` / `_like` / `_repost` / `_mention` / `_reply` | fediverse activity |
| `@plugin.on("custom.event")` | a plugin-emitted custom event |
| `@plugin.on_tab_content("slug")` / `@plugin.on_page_content("slug")` | render dynamic viewer-page HTML |

Payloads are attribute objects with `snake_case` accessors over the wire JSON (`msg.body`, `msg.user.display_name`, `msg.client_id`). Use `msg.raw` for the underlying dict.

### HTTP routing

Plugins with `http.serve` can answer requests under `/plugins/<slug>/…`. Route by path and method declaratively:

```python
@plugin.get("/api/messages")
def list_messages(req):
    return {"status": 200, "body": "...", "headers": {"Content-Type": "application/json"}}

@plugin.post("/api/messages")
def add_message(req):
    body = req.body
    return {"status": 201}

@plugin.on_http_request("/health")   # any method, exact path
def health(req):
    return "ok"                       # a plain string → 200 with that body

@plugin.on_http_request               # bare: catch-all fallback
def fallback(req):
    return {"status": 404}
```

- `@plugin.get/post/put/delete/patch(path)` and `@plugin.route(path, methods=[...])` for method-specific routes; `@plugin.on_http_request(path)` for any method.
- Paths are exact and **plugin-relative** (e.g. `/api/messages`), excluding the query string — read query params from `req.query`.
- A request whose path matches a route but not its method gets an automatic **405**; an unmatched path falls through to the bare catch-all, else **404**.
- A handler returns a `dict` (`{status, body, headers}`), a `str` (→ 200), or `None` (→ 204).

### The `owncast` host API

`owncast.<group>.<method>(...)`; each group is gated by the matching manifest permission.

| Group | Methods |
|---|---|
| `chat` | `send`, `send_action`, `system`, `send_to`, `reply_to`, `history`, `clients`, `delete_message`, `kick` |
| `kv` | `get`, `set`, `get_json`, `set_json`, `delete` |
| `storage` / `fs` | `storage.upload`; `fs.read_text`, `fs.write`, `fs.list`, `fs.delete`, `fs.exists` |
| `server` / `stream` | `server.info/socials/emotes/federation/tags`; `stream.current/broadcaster` |
| `video_config` | `read`, `write` |
| `notifications` | `discord`, `browser_push`, `fediverse` |
| `users` | `list`, `get`, `set_enabled`, `ban_ip` |
| `events` / `fediverse` / `sse` | `events.emit`; `fediverse.post`; `sse.send` |
| `actions` | `add`, `clear` |
| `timer` | `set_timeout`, `set_interval`, `clear` |
| `config` / `assets` / `http` | `config.get`; `assets.read_text`; `http.fetch` (needs `network.fetch` + `network.allowedHosts`) |

Return values that are JSON objects come back as the same attribute objects (`owncast.server.info().name`); lists come back as Python lists.

The concepts (events, permissions, the `.ocpkg` format, the manifest) are shared with the JS SDK, so the **[Owncast Plugin Author Guide](https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md)** applies — just read the API names as their Pythonic `snake_case` forms.

## How it works (and how it differs from the JS SDK)

`extism-py` compiles a **single** `.py` file and can't import a separate package inside the wasm. So `owncast_plugin_build.py` **inlines** this runtime, your `src/plugin.py`, and the host-function imports your permissions grant into one module, then runs `extism-py` on it. You still `from owncast_plugin import …` for editor support and unit tests; the build handles the inlining.

Consequences worth knowing:

- **Pure-Python only.** Dependencies with C extensions (numpy, pandas, etc.) won't compile. Pure-Python packages work if you vendor them. For outbound HTTP use `owncast.http.fetch`, not `requests`.
- **Don't shadow stdlib names at module top level.** Because your code is inlined alongside the runtime (which does `import json`), a top-level `def json(...)` in your plugin shadows it and breaks the build. Name helpers like `json_response` instead.
- **`snake_case` everywhere**, vs the JS SDK's camelCase (`send_action`, `get_json`, `msg.user.display_name`, `filter.pass_()` — `pass` is a Python keyword).

## Testing

`__tests__/*.test.json` scenario files are **identical in format to the JS SDK's** and run through the same `owncast-plugin-test` binary — so a Python port of a plugin can reuse the JS version's test scenarios verbatim. Each scenario dispatches events / HTTP requests and asserts on observed side effects (`chatSends`, kv writes, HTTP responses, …).

## Status

Working today: the runtime (`owncast_plugin/`), the inlining build tool (`owncast_plugin_build.py`), the full host API, HTTP routing, and CI that builds + tests every example. All 27 of the JS example plugins have Python counterparts under [`examples/python/`](../../examples/python).

Not yet (roadmap): a PyPI/`uv`-installable package, a one-shot `owncast-plugin-py` CLI with lazy toolchain download (so you don't install `extism-py`/binaryen by hand), a `create-owncast-plugin`-style scaffolder, `.ocpkg` packaging command, and type stubs.

## License

MIT
