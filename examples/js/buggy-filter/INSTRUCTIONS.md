# Buggy Filter (demo)

A deliberately broken chat filter. It throws an error on every message it sees. It exists only to demonstrate the host's **fail-open** safety behavior — you would never ship a plugin that looks like this.

## What to expect when enabled

1. Enable the plugin and send any chat message.
2. The filter throws, but the message still appears in chat **unmodified** — a filter that errors does not drop or block the message.
3. If it keeps throwing, the host's strike system eventually **auto-disables** the plugin for the rest of the session to protect chat throughput.

## Why it's here

To prove that one misbehaving filter can't take down chat. Read it alongside `profanity-filter` and `slow-mode` to see what a correct filter looks like.

## Permissions

- **chat.filter** — registers a filter in the chat pipeline (the only way to demonstrate the failure mode).
