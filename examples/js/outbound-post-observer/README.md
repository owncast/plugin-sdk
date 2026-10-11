# outbound-post-observer

Watches locally persisted outbound ActivityPub activities and posts a chat notice only for public `Create(Note)` activities. The example checks both the activity and object types, then checks the activity and object `to`/`cc` audiences before acting; private activities and other types are ignored.

**Demonstrates:** `onFediverseOutbound(activity)`, `Events.FediverseOutbound`, the raw ActivityPub payload, and the `fediverse.outbound` permission. It does not crosspost or promise remote delivery success.
