# create-owncast-plugin

Scaffold a new [Owncast](https://owncast.online) plugin project.

```sh
npm create owncast-plugin my-plugin
# or:
npx create-owncast-plugin my-plugin
```

Drops a working starter project into `./my-plugin/` with:

- `plugin.manifest.json`, name, version, permissions
- `src/plugin.js`, your handler code
- `__tests__/plugin.test.json`, sample scenario test
- `package.json`, pre-wired with `@owncast/plugin-sdk` and the `build`/`test` scripts

Then:

```sh
cd my-plugin
npm install   # postinstall fetches the wasm toolchain
npm run build # produces my-plugin.wasm + my-plugin.ocpkg
npm test
```

Full author guide: **[Owncast Plugin Author Guide](https://github.com/owncast/plugin-sdk/blob/main/docs/PLUGIN_AUTHOR_GUIDE.md)**

## License

MIT
