# hello-world

The minimum viable plugin. No event handlers. Importing the SDK registers the (empty) handler set, just enough to verify that the load + `register()` path works end to end. A plugin author can start here and add handlers one at a time.

**Demonstrates:** manifest parsing, `from owncast_plugin import plugin, owncast` with zero handlers, the host's load + register handshake.
