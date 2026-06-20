# owncast-plugin-sdk (Python)

SDK for authoring [Owncast](https://owncast.online) plugins in **Python**. Plugins ship their Python source and run sandboxed inside the Owncast server on an embedded Python engine. They use the same runtime, wire protocol, and `.ocpkg` format as the [JavaScript SDK](../js), so a Python plugin is a first-class peer of a JS one.

You write ordinary Python with decorators. There is no compile step and no PDK to install: the Owncast host embeds one Python engine and runs every Python plugin on it, so your plugin ships as plain source.

> ### Plugins are source, not a compiled binary
>
> Because the host supplies the Python engine, a plugin package contains only your `plugin.py`, its manifest, and any assets, with no bundled interpreter. That keeps packages small and means an author never installs or runs a wasm toolchain (`extism-py`, binaryen) at all. Those are a maintainer-only dependency of building the engine itself.

## Quick start

Install the SDK to get the `owncast-plugin-py` CLI. It fetches and caches the host test/serve binaries on first use, so there's nothing else to install by hand. There's no wasm compiler to fetch, because plugins run on the engine the host embeds.

```sh
pip install owncast-plugin-sdk          # or:  uv tool install owncast-plugin-sdk
```

> Not on PyPI yet (publishing is the last roadmap item). Until then, install from this repo with `uv tool install ./sdks/python` (or `pip install ./sdks/python`). That puts `owncast-plugin-py` on your PATH so every command below works as written.
>
> You *can* run it without installing via `uvx --from ./sdks/python owncast-plugin-py …`, but `uvx` is one-shot: the command isn't added to your PATH, so you must repeat the `uvx --from ./sdks/python` prefix on **every** command (`new`, `test`, `package`, …), not just the first. Installing once is simpler.

Scaffold a new plugin project (the Python peer of `npm create owncast-plugin`):

```sh
owncast-plugin-py new my-plugin         # drops a working starter into ./my-plugin
```

This writes a `my-plugin/` directory with `plugin.manifest.json`, `src/plugin.py`, a sample `__tests__/plugin.test.json`, and docs (README, INSTRUCTIONS.md, AGENTS.md + a `create-owncast-plugin-py` skill) already wired up. A plugin is just a directory:

```
my-plugin/
├── plugin.manifest.json     # name, slug, version, permissions
├── src/plugin.py            # your code
└── __tests__/*.test.json    # optional scenario tests
```

Build, test, serve, and package it:

```sh
owncast-plugin-py build my-plugin      # emit src/plugin.py -> <slug>.py
owncast-plugin-py test my-plugin       # run the __tests__/ scenarios
owncast-plugin-py serve my-plugin      # local dev server (POST /_dev/chat to drive it)
owncast-plugin-py package my-plugin    # build + bundle -> <slug>.ocpkg (the only file you ship)
```

Install the `.ocpkg` in Owncast from the admin **Plugins** page (**Upload plugin**) or by copying it to the server's `data/plugins/` directory, then toggle **Enabled**.

> **CI / no-install:** the build/package step is also runnable directly with `python3 sdks/python/owncast_plugin_build.py <dir> [--package]`, with no toolchain on `PATH` (it just emits source). `OWNCAST_PLUGIN_HOST_BIN_DIR` points `test`/`serve` at locally-built host binaries, and `OWNCAST_PLUGIN_HOST_BINARIES_VERSION` pins the release they're fetched from.

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
| `@plugin.on_page_styles` / `@plugin.on_page_scripts` | inject viewer-page CSS / JS computed at request time |

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

Plugins run on a Python engine the Owncast host embeds and shares across every Python plugin, so there's no per-plugin compile. `build` writes your `src/plugin.py` out as `<slug>.py`, stripping the `from owncast_plugin import …` line because the SDK names are already globals in the engine, and `package` zips that with the manifest and assets into the `.ocpkg`. You still `from owncast_plugin import …` for editor support and unit tests.

Consequences worth knowing:

- **Pure-Python only.** The embedded engine runs pure Python. Dependencies with C extensions (numpy, pandas, etc.) won't load. Pure-Python packages work if you vendor them. For outbound HTTP use `owncast.http.fetch`, not `requests`.
- **Don't shadow stdlib names at module top level.** Your code runs in the same global scope as the runtime (which does `import json`), so a top-level `def json(...)` in your plugin shadows it and breaks things. Name helpers like `json_response` instead.
- **`snake_case` everywhere**, vs the JS SDK's camelCase (`send_action`, `get_json`, `msg.user.display_name`, `filter.pass_()` — `pass` is a Python keyword).

## Testing

`__tests__/*.test.json` scenario files are **identical in format to the JS SDK's** and run through the same `owncast-plugin-test` binary — so a Python port of a plugin can reuse the JS version's test scenarios verbatim. Each scenario dispatches events / HTTP requests and asserts on observed side effects (`chatSends`, kv writes, HTTP responses, …).

## Status

Working today: the runtime (`owncast_plugin/`), the `owncast-plugin-py` CLI (`new`/`build`/`test`/`serve`/`package`) with lazy host-binary download, the full host API, HTTP routing, `.ocpkg` packaging, a pip/uv-installable package (`pyproject.toml`), and CI that builds + tests every example. All 27 of the JS example plugins have Python counterparts under [`examples/python/`](../../examples/python).

Not yet (roadmap): publishing to PyPI and type stubs.

## License

MIT
