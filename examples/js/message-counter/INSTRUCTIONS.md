# Message Counter

Counts how many chat messages each user has sent and posts their running total back to chat. Counts are kept in the plugin's private storage, so they survive server restarts.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Post in chat. The bot ("Example Counter") replies with that user's running total, e.g. `alice has sent 4 messages`.

Counts accumulate indefinitely and persist across restarts. Each plugin's storage is namespaced and private, so these counts are never visible to other plugins.

## Permissions

- **storage.kv** — persists each user's count.
- **chat.send** — posts the total back to chat.
