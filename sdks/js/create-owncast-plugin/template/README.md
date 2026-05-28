# **PLUGIN_NAME**

An Owncast plugin scaffolded with `create-owncast-plugin`.

## Develop

```sh
npm install          # one-time, fetches the toolchain
npm run build        # compile src/plugin.js → __PLUGIN_NAME__.wasm
npm test             # build, then run scenarios from __tests__/
npm run serve        # build, then host the plugin on http://localhost:8080
npm run package      # build, then bundle into __PLUGIN_NAME__.ocpkg for distribution
```

## Ship

`npm run package` produces `__PLUGIN_NAME__.ocpkg`. Drop it into your Owncast server's `plugins/` directory and enable it from the admin.

## Files

- `src/plugin.js`, your handler code; edit this
- `plugin.manifest.json`, name, version, permissions
- `__tests__/plugin.test.js`, a sample scenario test; add more

## Learn more

The full author guide covers every event handler, host API, permission, and testing pattern:

**[→ Owncast Plugin Author Guide](https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md)**

TypeScript declarations in `@owncast/plugin-sdk` give editor autocomplete on every API.
