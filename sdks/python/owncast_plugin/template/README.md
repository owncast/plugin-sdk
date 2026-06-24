# __PLUGIN_DISPLAY_NAME__

An Owncast plugin scaffolded with `owncast-plugin-py new`. The slug is `__PLUGIN_SLUG__`, and everything below uses it as the build artifact filename and the URL prefix Owncast routes through your plugin.

## Develop

```sh
owncast-plugin-py build        # emit src/plugin.py as __PLUGIN_SLUG__.py
owncast-plugin-py test         # build, then run scenarios from __tests__/
owncast-plugin-py serve        # build, then host the plugin on http://localhost:8080
owncast-plugin-py package      # build, then bundle into __PLUGIN_SLUG__.ocpkg for distribution
```

These commands assume `owncast-plugin-py` is on your PATH (`uv tool install owncast-plugin-py`, or `pip install owncast-plugin-py`). If you instead run it through `uvx` without installing, prefix every command with `uvx owncast-plugin-py `, since `uvx` is one-shot and doesn't add the command to your PATH.

Plugins ship as source and run on the Python engine the Owncast host embeds, so there's no compile step and no toolchain to install. `test`/`serve` download and cache the host binaries on first use, and that's it.

## Ship

`owncast-plugin-py package` produces `__PLUGIN_SLUG__.ocpkg`. Install it through the Owncast admin: open **Plugins**, click **Upload plugin**, and pick the file. (You can also copy it directly to the server's `data/plugins/` directory if the admin UI isn't an option.) Toggle **Enabled** to load it.

## Files

- `src/plugin.py`, your handler code. Edit this
- `plugin.manifest.json`, the manifest: display name, slug, version, permissions, and optional `bot.displayName` for the chat identity
- `__tests__/plugin.test.json`, a sample scenario test. Add more
- `icon.png` (optional), drop a square PNG here and it bundles into the `.ocpkg` automatically. The admin uses it in the plugin list and sidebar, no permission required. Plugins without one fall back to a generic puzzle-piece glyph.
- `INSTRUCTIONS.md` (optional), edit this and it bundles into the `.ocpkg` automatically. The admin renders it as markdown in an **Instructions** tab on the plugin's details page, no permission required.

## Learn more

The full author guide covers every event handler, host API, permission, and testing pattern (read the API names as their Pythonic `snake_case` forms):

**[→ Owncast Plugin Author Guide](https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md)**

`from owncast_plugin import plugin, owncast, filter` is importable on your dev machine for editor support and unit tests.
