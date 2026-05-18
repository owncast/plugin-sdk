# __PLUGIN_NAME__

An Owncast plugin scaffolded with `create-owncast-plugin`.

## Develop

```sh
npm install          # one-time, fetches the toolchain
npm run build        # bundles src/plugin.js → __PLUGIN_NAME__.wasm + __PLUGIN_NAME__.ocpkg
npm test             # runs scenarios from __tests__/
```

## Ship

```sh
npx owncast-plugin package    # produces __PLUGIN_NAME__.ocpkg
```

Drop the resulting `.ocpkg` into your Owncast server's `plugins/` directory and enable it from the admin.

## Files

- `src/plugin.js` — your handler code; edit this
- `plugin.manifest.json` — name, version, permissions
- `__tests__/plugin.test.json` — a sample scenario test; add more

## Learn more

The full author guide covers every event handler, host API, permission, and testing pattern:

**[→ Owncast Plugin Author Guide](https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md)**

TypeScript declarations in `@owncast/plugin-sdk` give editor autocomplete on every API.
