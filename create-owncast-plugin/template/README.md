# __PLUGIN_NAME__

An Owncast plugin.

## Build

```sh
npm install
npm run build
```

Produces `__PLUGIN_NAME__.wasm`. Drop that and `plugin.manifest.json` into your Owncast `plugins/` directory.

## Test

```sh
npm test
```

Runs scenario-based tests in `__tests__/*.test.json` against the actual built wasm, using the same plugin runtime Owncast itself uses — no Owncast restart, no live stream. Edit `__tests__/plugin.test.json` to add scenarios.

A scenario looks like:

```json
[
  {
    "name": "what this scenario verifies",
    "given": { "kv": { "some-key": "initial value" } },
    "events": [
      {
        "event": "chat.message.received",
        "payload": { "id": "1", "user": "alice", "body": "hello" }
      }
    ],
    "expect": {
      "chatSends": ["expected reply"],
      "kv": { "some-key": "new value" }
    }
  }
]
```

Use `"filter": "<event>"` instead of `"event": "<event>"` to test a filter handler; add an inline `"expect": { "action": "modify", "payload": { "body": "..." } }` to assert on the FilterResult.

## Edit

Plugin code lives in `src/plugin.js`. Declare events you want to receive and permissions you need in `plugin.manifest.json`.

Available Owncast APIs (need matching permission):

- `owncast.chat.send(text)` — `chat.send`
- `owncast.kv.get(key)` / `owncast.kv.set(key, value)` — `storage.kv`
- `owncast.events.emit(eventType, payload)` — `events.emit`
