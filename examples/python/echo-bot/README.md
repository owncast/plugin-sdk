# echo-bot

Replies to every chat message with `"<user> said: <body>"`, posting under the plugin's own bot identity that the host provisions automatically.

This was the original Python spike that proved the python-pdk round trip, so its manifest name and slug (`py-echo-bot`) differ from the JS `echo-bot` — but the behavior is the same.

**Demonstrates:** posting to chat via `owncast.chat.send(text)`, the `chat.send` permission, the `@plugin.on_chat_message` handler.
