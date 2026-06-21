# Timer Bot

Demonstrates the two ways an Owncast plugin does time-based work, driven from
chat. There is no `setTimeout` in the plugin sandbox, so:

- **`owncast.timer`** asks the host to run a callback later: `setTimeout` (once),
  `setInterval` (repeating), and `clear(id)` to cancel. Active only while
  scheduled.
- **`onTick`** fires once a second, for open-ended periodic work.

Neither needs a permission. (Timers are in-memory: they don't survive a plugin
reload or a host restart.)

## Chat commands

| Command | What it does | Mechanism |
| --- | --- | --- |
| `!remind <seconds> <message>` | Sends `message` back to you after the delay | `setTimeout` |
| `!every <seconds> <message>` | Repeats `message` until `!stop` | `setInterval` |
| `!countdown <seconds>` | Counts down live, one number a second | `onTick` |
| `!stop` | Cancels the repeater and any pending reminder | `clear` |

```js
onChatMessage(msg) {
  // !remind 30 stretch  ->  in 30s: "@you reminder: stretch"
  reminderId = owncast.timer.setTimeout(
    () => owncast.chat.send(`@${msg.user} reminder: ${message}`),
    seconds * 1000,
  );
}

onTick() {
  // counts down a number a second when armed by !countdown
  if (countdown > 0) { owncast.chat.send(String(countdown)); countdown--; }
}
```

## Run it

```bash
npm install
npm test        # build + run the tests
npm run serve   # build + serve a dev instance
```

The test/dev tooling can drive chat and the tick directly, so you can exercise
every command without a running Owncast:

```bash
# in another terminal, against `npm run serve`
curl -XPOST localhost:8080/_dev/chat  -d '{"user":"alice","body":"!countdown 5"}'
curl -XPOST localhost:8080/_dev/event -d '{"type":"tick","payload":{"now":0}}'
```

In a real Owncast install the tick fires on its own once a second, and timers
fire on their own schedule.
