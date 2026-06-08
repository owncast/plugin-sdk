# hello-world plugin: no event handlers, just proves the load + register()
# path works end-to-end. Importing the SDK registers the (empty) handler set.
from owncast_plugin import plugin, owncast  # noqa: F401
