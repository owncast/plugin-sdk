# @owncast/plugin-sdk

SDK for authoring [Owncast](https://owncast.online) plugins in JavaScript or TypeScript. Plugins compile to WebAssembly and run sandboxed inside the Owncast server.

Most authors don't install this directly — instead, scaffold a new project with `npm create owncast-plugin <name>` and the generated `package.json` already lists it as a dependency.

## Quick start

```sh
npm create owncast-plugin my-plugin
cd my-plugin
npm install   # postinstall fetches the per-platform wasm toolchain
npm run build # bundles src/plugin.js → my-plugin.wasm + my-plugin.ocpkg
npm test      # runs scenarios from __tests__/
```

Then drop `my-plugin.ocpkg` into your Owncast server's `plugins/` directory and enable it from the admin.

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

- `index.js` — runtime: `definePlugin`, the `owncast.*` host wrappers, the `filter` constructor.
- `index.d.ts` — TypeScript declarations for editor autocomplete on every event payload and host API.
- `bin/owncast-plugin` — CLI: `build`, `test`, `serve`, `package` subcommands.
- `scripts/postinstall.js` — downloads the per-platform wasm toolchain (`extism-js`, `wasm-merge`, `wasm-opt`) and the Go test/serve runner on install.

## License

MIT
