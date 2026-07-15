# All Permissions Test

A build/load canary, not a real plugin: it declares every permission the host
offers and registers a no-op handler for every subscription.

**Why it exists:** the install-time load check (`owncast-plugin-test`) runs the
same load path a real Owncast server runs — manifest validation, `register()`,
and permission-gated subscriptions. CI builds the host binaries from
`owncast@develop`, so this plugin fails CI in one obvious place when:

- a subscription gains a permission gate (like `chat.filter` or
  `fediverse.inbound`) that this manifest doesn't satisfy,
- a new load-time manifest validation rule lands,
- registration semantics change (`register()` output, manifest/runtime
  agreement, an engine handler mapping the host stops accepting).

**What it does not catch:** call-time permission changes. Those permissions are
silent no-ops at call time and their manifest strings aren't validated against
a catalog at load, so renaming or removing one leaves this canary green. When
the host's permission catalog changes, update this manifest, the Python twin
(`examples/python/all-permissions-test`), and the permission table in
`docs/PLUGIN_AUTHOR_GUIDE.md` by hand.

It ships no scenario tests on purpose: the load check *is* the test.
