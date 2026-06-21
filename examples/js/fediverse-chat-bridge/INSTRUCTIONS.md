# Fediverse Chat Bridge

Surfaces fediverse engagement directly in your stream's chat. When someone on the fediverse mentions or replies to your account, this plugin posts a **system message** in chat showing their avatar, display name, handle (linked to their profile), and the post text (linked to the original).

## Setup

Your server's **fediverse / federation** must be enabled (**Admin → Social / Federation**) so Owncast receives mentions and replies. Then enable this plugin in **Admin → Plugins**.

## What you'll see

When a remote fediverse user mentions or replies to you, a system message (no chat-user identity, posted by "Example Fediverse") appears in chat, for example:

> 🖼 **Alex** @alex@example.social, great stream tonight!

The name links to their profile and the text links to the original post.

All remote text is HTML-escaped before display, so a malicious post can't inject markup into chat.

## Permissions

- **chat.send**: posts the system messages under the plugin's bot identity.
