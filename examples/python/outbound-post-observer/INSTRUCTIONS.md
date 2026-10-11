# Outbound Post Observer

When enabled, this plugin watches outbound ActivityPub activities and sends an Owncast chat notice only for a public `Create(Note)`. It checks both the activity and object types, then checks `to` and `cc` for the ActivityStreams Public collection at each level that specifies an audience.

## How to use it

1. Enable the plugin in **Admin → Plugins**.
2. Publish a public post. The bot ("Outbound Observer") posts `Observed a public Fediverse post.` in chat.
3. Private posts and other activity/object types do not trigger the chat notice.

The observer runs after local persistence, not after remote delivery. Ordinary private activities can reach the outbound hook, so this example ignores them. Authentication messages containing one-time codes are excluded by the producer.

## Permissions

- **fediverse.outbound**: observes raw outbound ActivityPub activities, including ordinary private activities.
- **chat.send**: posts the demonstration notice to chat.

This example does not crosspost. Any plugin that republishes an activity should check its type, object type, and audience before forwarding it.
