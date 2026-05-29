# @owncast/plugin-sdk

SDK for authoring [Owncast](https://owncast.online) plugins in JavaScript or TypeScript. Plugins compile to WebAssembly and run sandboxed inside the Owncast server.

Most authors don't install this directly, instead, scaffold a new project with `npx create-owncast-plugin@latest <slug>` and the generated `package.json` already lists it as a dependency.

## Quick start

```sh
npx create-owncast-plugin@latest my-plugin
cd my-plugin
npm install     # postinstall fetches the per-platform wasm toolchain
npm run build   # compiles src/plugin.js into an intermediate build artifact
npm run package # zips manifest + wasm + assets + icon.png into my-plugin.ocpkg
npm test        # runs scenarios from __tests__/
```

Then install `my-plugin.ocpkg` in Owncast. From the admin's **Plugins** page click **Upload plugin** and pick the file, or copy it directly to the server's `data/plugins/` directory. Toggle **Enabled** on the plugin's row to load it.

## Writing a plugin

```js
const { definePlugin, owncast, filter } = require("@owncast/plugin-sdk");

module.exports = definePlugin({
  onChatMessage(msg) {
    owncast.chat.send(`echo: ${msg.body}`);
  },

  filterChatMessage(msg) {
    return msg.body.includes("spam") ? filter.drop("spam") : filter.pass();
  },
});
```

Declare the permissions your plugin uses (`chat.send` for the example above) in `plugin.manifest.json`. The full author guide covers every event handler, host API, and the testing harness:

**[→ Owncast Plugin Author Guide](https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md)**

## What's in the package

- `index.js`, runtime: `definePlugin`, the `owncast.*` host wrappers, the `filter` constructor.
- `index.d.ts`, TypeScript declarations for editor autocomplete on every event payload and host API.
- `testing.js`, JS test API (`runScenarios`) for writing `__tests__/*.test.js` with the full ergonomics of JavaScript instead of static JSON.
- `bin/owncast-plugin`, CLI: `build`, `test`, `serve`, `package` subcommands.
- `scripts/postinstall.js`, downloads the per-platform wasm toolchain (`extism-js`, `wasm-merge`, `wasm-opt`) and the Go test/serve runner on install.

## License

MIT
