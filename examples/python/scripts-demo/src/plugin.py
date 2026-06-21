# scripts-demo: declares a JavaScript file in manifest.scripts and
# ships no host-side behavior. The host validator rewrites the
# relative path into /plugins/scripts-demo/client.js. The viewer
# page <script>-injects that URL on load. Useful as the simplest
# possible demonstration that plugin-supplied JavaScript reaches the
# viewer page's window context.
from owncast_plugin import plugin  # noqa: F401
