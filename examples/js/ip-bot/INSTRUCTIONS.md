# IP Bot

A chat-command bot. When someone types `!ip` in chat, it fetches the server's public IP address from `api.ipify.org` and posts the result back to chat.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Type `!ip` in chat.
3. The bot ("Example IP Helper") replies with `server IP: <address>`.

The plugin can only reach `api.ipify.org`. That single host is declared in its manifest, and the host blocks any other outbound request.

## Permissions

- **chat.send**: posts the reply.
- **network.fetch**: makes the outbound HTTP request. It is paired with a manifest allowed-hosts list (`api.ipify.org`). The host refuses to load a plugin that requests `network.fetch` without naming the hosts it may contact.
