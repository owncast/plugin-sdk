# Chat Logger

Writes a line to the Owncast server log for every chat message. A read-only example that needs no permissions.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Post a normal chat message to write an info entry.
3. Post a message starting with `warning:` to write a warning entry.
4. Post a message starting with `error:` to write an error entry.

Each line includes `plugin chat-logger:` so an operator can identify its source. There is nothing to configure and no viewer-facing output.

## Permissions

None. Plugins can observe chat events and write attributed server log entries without declaring a permission.
