# All Permissions Test

A build/load canary, not a real plugin: it declares every permission the host
offers and registers a no-op handler for every subscription.

**Why it exists:** the install-time load check (`owncast-plugin-test`) runs the
same load path a real Owncast server runs — manifest validation, `register()`,
and permission-gated subscriptions. CI builds the host binaries from
`owncast@develop`, so this plugin fails CI in one obvious place the moment the
host adds, renames, or re-gates a permission or subscription, instead of via
whichever real example happens to trip on it.

It ships no scenario tests on purpose: the load check *is* the test.

When the host's permission catalog changes, update this manifest, the
JavaScript twin (`examples/js/all-permissions-test`), and the permission table
in `docs/PLUGIN_AUTHOR_GUIDE.md` together.
