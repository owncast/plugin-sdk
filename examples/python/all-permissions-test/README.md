# All Permissions Test

A build/load canary, not a real plugin: it declares every permission the host
offers and registers a no-op handler for every subscription.

**Why it exists:** the install-time load check (`owncast-plugin-test`) runs the
same load path as a real Owncast server, including manifest validation,
`register()`, and permission-gated subscriptions. CI builds the host binaries
from `owncast@develop`, so this plugin fails CI in one obvious place when:

- a subscription gains a permission gate (like `chat.filter` or
  `fediverse.inbound`) that this manifest doesn't satisfy,
- a new load-time manifest validation rule lands,
- registration semantics change (`register()` output, manifest/runtime
  agreement, an engine handler mapping the host stops accepting).

**What it does not catch:** most call-time permission changes. Those
permissions are silent no-ops at call time and their manifest strings are not
validated against a catalog at load. Renaming or removing one can leave this
canary green. When the host's permission catalog changes, update this manifest,
the JavaScript twin (`examples/js/all-permissions-test`), and the permission
table in `docs/PLUGIN_AUTHOR_GUIDE.md` by hand.

The focused binary scenario is the exception. It reads an invalid UTF-8 asset,
round-trips it through `storage.fs`, uploads it, and compares the exact bytes.
It protects Python's byte annotations and raw-data conveniences.
