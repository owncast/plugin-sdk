# Profanity Filter

A chat filter that redacts a built-in list of flagged words, replacing them with asterisks before the message reaches chat and notifications. The message still goes through, but the flagged words are masked.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Post a message containing a flagged word. It appears in chat with that word starred out (e.g. `****`).

The wordlist is hardcoded in this example. It demonstrates *modifying* a message in place rather than dropping it. For the opposite approach, see `slow-mode`, which drops messages outright.

## Permissions

- **chat.filter**: lets the plugin inspect and rewrite chat messages in the filter pipeline.
