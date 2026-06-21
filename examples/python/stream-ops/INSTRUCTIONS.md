# Stream Ops

Chat commands for inspecting and tuning your video pipeline from the chat box.

## Commands

Enable the plugin in **Admin → Plugins**, then type these in chat:

| Command | What it does |
| --- | --- |
| `!broadcaster` | Reports details about the inbound stream you're sending (the encode Owncast is receiving). |
| `!videoconfig` | Reports the current output / transcoding configuration. |
| `!latency <n>` | Sets the output latency level to `n`. Lower means viewers see the stream sooner but rebuffer more on flaky networks. |

The bot posts each answer back to chat. `!latency` changes live output settings, so use it deliberately. Anyone who can post in chat can run it.

## Permissions

- **chat.send**: posts the answers.
- **server.read**: reads broadcaster telemetry.
- **videoconfig.read**: reads the current video configuration.
- **videoconfig.write**: the privileged half. Lets `!latency` change live transcoding settings.
