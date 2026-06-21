// Shared JS engine bootstrap. Compiled ONCE into engine.wasm and reused by
// every JS plugin. Instead of baking the manifest + author code into the
// module, it reads them from Extism config at runtime and evals the author
// bundle into the shared SDK instance. Because this file is fixed, engine.wasm
// is byte-identical for every plugin, so wazero compiles the QuickJS engine
// once and the host shares it across all loaded plugins.
//
// The host (Owncast) instantiates this engine per plugin and, before the first
// call, sets the Extism config keys:
//   __slug:    the plugin's slug (host functions read it back to resolve identity)
//   script:    the plugin's bundled JS (the author's plugin.js with the SDK external)
//   manifest:  the plugin's manifest JSON (echoed by register() with derived subscriptions)
const sdk = require("@owncast/plugin-sdk");

let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  const src = Config.get("script");
  if (!src) return; // build-time (Wizer) pre-init: no config yet, defer.
  const module = { exports: {} };
  const require_ = (name) => {
    if (name === "@owncast/plugin-sdk") return sdk;
    throw new Error("plugin required unknown module: " + name);
  };
  // new Function gives the author bundle a clean CommonJS-style scope without
  // leaking the engine's own locals into it.
  const fn = new Function("module", "exports", "require", src);
  fn(module, module.exports, require_);
  loaded = true;
}

function register() {
  ensureLoaded();
  const base = JSON.parse(Config.get("manifest") || "{}");
  const manifest = Object.assign({}, base, {
    subscriptions: sdk.describeSubscriptions(),
    commands: sdk.describeCommands(),
  });
  Host.outputString(JSON.stringify(manifest));
  return 0;
}
function on_event() {
  ensureLoaded();
  sdk.dispatchEvent(JSON.parse(Host.inputString()));
  return 0;
}
function on_filter() {
  ensureLoaded();
  Host.outputString(JSON.stringify(sdk.dispatchFilter(JSON.parse(Host.inputString()))));
  return 0;
}
function on_http_request() {
  ensureLoaded();
  Host.outputString(JSON.stringify(sdk.dispatchHttp(JSON.parse(Host.inputString()))));
  return 0;
}
// on_auth_check re-validates a viewer's session on page load (the host calls it
// only for the active auth.gate plugin, only on /). Input is { user }. Output
// is a verdict { action: "ok" | "refresh" | "deny", ttl?, reason? }.
function on_auth_check() {
  ensureLoaded();
  Host.outputString(JSON.stringify(sdk.dispatchAuthCheck(JSON.parse(Host.inputString()))));
  return 0;
}
function on_tab_content() {
  ensureLoaded();
  Host.outputString(sdk.dispatchTabContent(JSON.parse(Host.inputString())));
  return 0;
}
function on_page_content() {
  ensureLoaded();
  Host.outputString(sdk.dispatchPageContent(JSON.parse(Host.inputString())));
  return 0;
}
// on_page_styles / on_page_scripts take no input. The host calls them once
// per /api/config for any plugin holding ui.modify, and the returned CSS/JS is
// appended to the viewer page's customStyles / customJavascript.
function on_page_styles() {
  ensureLoaded();
  Host.outputString(sdk.dispatchPageStyles());
  return 0;
}
function on_page_scripts() {
  ensureLoaded();
  Host.outputString(sdk.dispatchPageScripts());
  return 0;
}
module.exports = {
  register,
  on_event,
  on_filter,
  on_http_request,
  on_auth_check,
  on_tab_content,
  on_page_content,
  on_page_styles,
  on_page_scripts,
};
