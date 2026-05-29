# __PLUGIN_DISPLAY_NAME__

An Owncast plugin scaffolded with `create-owncast-plugin`. The slug is `__PLUGIN_SLUG__`; everything below uses it as the build artifact filename and the URL prefix Owncast routes through your plugin.

## Develop

```sh
npm install          # one-time, fetches the toolchain
npm run build        # compile src/plugin.js into an intermediate build artifact
npm test             # build, then run scenarios from __tests__/
npm run serve        # build, then host the plugin on http://localhost:8080
npm run package      # build, then bundle into __PLUGIN_SLUG__.ocpkg for distribution
```

## Ship

`npm run package` produces `__PLUGIN_SLUG__.ocpkg`. Install it through the Owncast admin: open **Plugins**, click **Upload plugin**, and pick the file. (You can also copy it directly to the server's `data/plugins/` directory if the admin UI isn't an option.) Toggle **Enabled** to load it.

## Files

- `src/plugin.js`, your handler code; edit this
- `plugin.manifest.json`, the manifest: display name, slug, version, permissions, and optional `bot.displayName` for the chat identity
- `__tests__/plugin.test.js`, a sample scenario test; add more
- `icon.png` (optional), drop a square PNG here and it bundles into the `.ocpkg` automatically. The admin uses it in the plugin list and sidebar; no permission required. Plugins without one fall back to a generic puzzle-piece glyph.

## Learn more

The full author guide covers every event handler, host API, permission, and testing pattern:

**[→ Owncast Plugin Author Guide](https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md)**

TypeScript declarations in `@owncast/plugin-sdk` give editor autocomplete on every API.
