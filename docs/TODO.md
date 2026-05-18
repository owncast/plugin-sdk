# TODO / Open Ideas

Punch list of design ideas and concrete work items still to do. Organized by area, roughly in declining "would change author or admin experience meaningfully" order.

Status legend:
- 💭 **idea** — design discussion needed
- 🛠️ **planned** — design settled, just needs building
- 🪲 **bug / polish** — known issue with a clear fix

---

## Admin UI integration

### Plugins surface in the Owncast admin ✅ — shipped (host side)

**The idea.** A plugin should be able to register an admin page — its own HTML+JS+CSS that lives inside the Owncast admin interface. Click "Plugins" in the admin nav → see a list of installed plugins → click one → land on that plugin's config UI. From there the plugin can expose per-server settings, dashboards, moderation tools, etc.

**Why.** Plugins today have no UX surface to an admin beyond log lines and chat messages. Anything configurable has to be hardcoded or piggyback on the existing Owncast admin (which the plugin can't extend). Authors will want config UIs — wordlists, API keys, thresholds, dashboards — and admins will want a discoverable place to find them.

**Approach to consider.**

The plugin declares admin pages in its manifest:

```json
{
  "permissions": ["http.serve"],
  "admin": {
    "pages": [
      {
        "title": "Profanity Filter Settings",
        "path": "/admin",
        "icon": "shield"
      },
      {
        "title": "Banned Words",
        "path": "/admin/words"
      }
    ]
  }
}
```

The Owncast admin web app gets a new "Plugins" section in its nav. For each plugin's manifest entries, it shows the title + icon. Clicking loads the plugin's HTML at `/plugins/<name>/<path>` — via either:

- **iframe** (recommended for v1) — strong isolation, plugin CSS/JS can't break admin UI, plugin can use any framework, standard browser sandbox. Plugin loads in its own browsing context; postMessage can be used if cross-frame communication ever matters.
- **shadow DOM / custom element** — more visually integrated but plugin styling is constrained; more work to do safely.

Start with iframe. The admin SPA renders something like `<iframe src="/plugins/<name>/admin">`.

**Security**

Admin pages need to require Owncast admin auth. Two ways to enforce:

1. **Manifest declares admin-only paths** — `admin.pages[].path` is implicitly admin-only; the host returns 401 on those routes for unauthenticated requests. Plugin code never sees unauthenticated requests for those paths.
2. **Plugin checks `req.authenticated` itself** — already the default-public model. Author has to remember.

(1) is safer because authors can't forget. The host treats anything in `admin.pages[].path` as admin-only; subpaths inherit (`/admin/*`).

**Open questions**

- **Iframe vs single-page integration:** iframes have ergonomic costs (separate scroll, sometimes weird focus). For v1 the safety/isolation wins. Worth re-evaluating once we know how common admin pages become.
- **Styling consistency:** plugins probably want to match the Owncast admin's look. Offering a CSS stylesheet plugins can `@import` (`/admin/plugin-style.css`) would help. Eventually a small web-component library (form fields, buttons, layout primitives) styled to match.
- **Page navigation:** does the plugin own routing within its iframe, or does the host orchestrate by reloading the iframe per `admin.pages[]` entry? Author-owned routing inside the iframe is simpler and more flexible.
- **State / config persistence:** plugin's admin page reads/writes config via its own `onHttpRequest` + KV. No new mechanism needed — but it does mean the plugin author handles the form submission flow. A future `owncast.config.*` API for typed admin-settable config (schema in the manifest, host enforces) would be cleaner.
- **What about admin pages without a frontend?** Some "admin pages" are really just a place to set a few values. A typed JSON-schema declaration in the manifest could let Owncast auto-render a config form without the plugin shipping HTML. Worth offering both: manifest-declared simple forms (host renders) and full custom pages (plugin serves).

**Concrete first step:** ship iframe-based admin pages, plugin author writes their own HTML. Skip auto-form-rendering for v2.

---

### Auto-registered chat bot identity ✅ — design settled (host-side abstraction shipped; Owncast-side provisioning is the integration piece)

**The model:** Each plugin owns exactly one chat identity. Owncast provisions a real chat user account when the plugin is installed — `IsBot: true`, `DisplayName` = the plugin's name, with its own access token. `owncast.chat.send(text)` and `owncast.chat.sendAction(text)` post through Owncast's normal chat pipeline using that bot's token.

Plugins cannot post under arbitrary names or impersonate real users. For multiple chat personas, ship multiple plugins (the original `sendAs` + `manifest.bots[]` allowlist machinery was removed in favor of this simpler model).

**What the PoC has:** the abstraction (`HostEnv.OnChat func(ChatSendRequest)`). The demo binary prints chat sends; the mock host records them.

**What needs real Owncast integration:**
- Plugin install hook: provision a chat User account with `IsBot: true`, generate an access token, store the (plugin name → token) mapping durably
- Real `OnChat` implementation: look up the bot's access token, call into Owncast's chat-send pipeline authenticated as that bot
- Uninstall hook: disable (don't delete — preserves chat history attribution) the bot accounts when a plugin is removed
- Maybe: surface bot accounts in the admin UI's user list with a "managed by plugin X" label so admins can mute/ban them through normal moderation

**The idea.** Every plugin gets a chat user identity automatically. `owncast.chat.send("hello world")` posts as the plugin's named bot account, not as a generic "[system]" message. The user appears in the chat client list, has a stable identity, a color, optionally an avatar.

**Why.** Right now plugin chat messages all look the same (system messages). With per-plugin identities:

- Users in chat can see *which plugin* spoke
- Plugins like `echo-bot` actually show up as "echo-bot" — what people would expect
- Multiple plugins posting don't feel like one entity talking to itself
- Native moderation tools work — admin can mute/ban a misbehaving plugin's bot the same way as any user

**Approach to consider.**

At plugin load:
- Compute a stable user ID — `hash(plugin name)` so the same plugin always maps to the same bot user across restarts and across deployments
- Look up or create a User record with that ID, `IsBot: true`, `DisplayName: <plugin display name>`
- Cache the user record on the plugin's `Loaded` struct

`owncast.chat.send(text)` then dispatches with the plugin's bot as the sender, not the system user.

Manifest hooks (all optional):

```json
{
  "bot": {
    "displayName": "Echo Bot",
    "color": "#7cf",
    "avatar": "/bot.png"
  }
}
```

- `displayName` — defaults to the plugin name
- `color` — defaults to a deterministic generated color from the plugin name
- `avatar` — path under `/plugins/<name>/...`, served from the plugin's static assets

**Companion API**

For plugins that want to send as multiple personas (e.g., a game plugin posting as different NPCs), keep a separate method:

```js
owncast.chat.send(text)               // sends as this plugin's bot
owncast.chat.sendAs(name, text)       // sends as a named persona, ad hoc
```

Both still require `chat.send` permission. `sendAs` doesn't create a persistent user — it sends a message with a custom display name only, like Owncast's `SendSystemMessage(text, name)` overload.

**Open questions**

- **Is the bot user visible in the user/client list?** Probably yes — admins and viewers should be able to see "echo-bot is online" the same way they see real users. Implies the host inserts a synthetic chat client connection on plugin load.
- **What if the admin wants to ban a plugin's bot?** Banning the user → the host's `chat.send` for that plugin starts failing (or no-ops). Either is reasonable. Failing-loud lets the plugin tell the admin "I'm muted"; no-op is more graceful. I'd default to no-op + a host log.
- **Can a plugin override its display name at runtime?** Probably no. Display name is set at manifest level. If the plugin wants varied posters, use `sendAs`.
- **Migration of existing plugins:** today's `owncast.chat.send` sends as system. The switch to "sends as plugin's bot" is a behavior change. Worth gating behind a new manifest field for backward compatibility, or just doing it in one go since this is still pre-1.0.

**Concrete first step:** add the bot user creation at load time, switch `chat.send` to use it. `sendAs` is a small follow-on if/when needed.

---

## Runtime / dispatcher

### Filter priority ✅ — shipped

`definePlugin({ filterPriority: N, ... })` — single number applies to every filter handler this plugin defines. Default 100. Lower runs earlier. Per-event priorities (option 2 below) can come later if needed.

### Strike system for failing plugins ✅ — shipped

Filter failures track per-plugin; after 5 consecutive errors the plugin is auto-disabled and skipped for the rest of the session. A successful call resets the counter. Disabled state is logged once at the transition (not on every subsequent dropped event).

### Filter timeouts ✅ — shipped (with one known limitation)

Each filter call is capped at 50 ms via `extism.Plugin.CallWithContext` with a deadline-bearing context. Wazero's `WithCloseOnContextDone` is enabled at instantiation (driven by setting `extism.Manifest.Timeout` to a 10 s outer ceiling), so the cancellation cooperatively unwinds in-flight wasm execution.

Timeouts return as a regular filter error, count as a strike, and trigger auto-disable after the threshold.

**Known limitation:** cancellation is cooperative — it fires at wasm function boundaries and at host-call boundaries. A pure-CPU JS busy loop (`while(true) {}`) running inside QuickJS's interpreter doesn't always hit those checkpoints, so a deliberate adversarial loop may not be cancellable mid-execution. Realistic slow filters (HTTP calls, regex passes, JSON parsing, KV lookups) all yield to host calls frequently enough that the timeout works as intended.

Future work to close the gap: experiment with Wazero `RuntimeConfig` knobs that inject more aggressive checks, or sandbox the plugin in a separate goroutine and let the strike system disable it from the outside on hangs.

### Cross-plugin event composition in tests 💭

Today's test harness loads one plugin per scenario. A scenario where plugin A emits an event and plugin B should handle it can't be expressed. Worth adding a "compose" mode: scenario specifies a list of plugins; the runner loads all of them; emitted events fan out for real (recorded but also actually delivered).

---

## Test harness

### Console.log assertions 🛠️

Plugins like `chat-logger` and `announcer` have no observable side effect other than `console.log`. Scenarios currently only test "didn't crash." Capture extism's logger output and add `expect.consoleOutput: ["pattern"]` to scenarios so log-only plugins can be tested meaningfully.

### Regex matchers in scenario assertions 🛠️

For string fields where exact match is too brittle (timestamps, generated IDs, URLs with variable params), support `/pattern/` syntax. Already documented as a future feature in the README; just needs implementing in `runner.go`.

### Better test failure output 🪲

Current failure messages show "want X got Y" with raw JSON. A diff-style display (line-by-line, with mismatched fields highlighted) would speed up debugging significantly.

### `npm test --watch` 🛠️

Rerun scenarios on file change. Either via the SDK CLI (add `--watch` flag) or by recommending a generic file watcher in the README. Saves seconds per cycle during active development.

---

## Distribution

### Single-file plugin format ✅ — shipped as `.ocpkg`

Plugins can now ship as a single `.ocpkg` file (zip archive: `plugin.manifest.json` + `plugin.wasm` + optional `assets/`). Built via `owncast-plugin package`. Host loads `.ocpkg` and loose files interchangeably from the same `plugins/` directory.

Open follow-on questions:
- **Signature support** — the package should eventually be signed by the author for verifiable provenance in a marketplace world. Today's `.ocpkg` has no signature; adding one is a wrapping concern (sign the archive's contents, store the signature alongside or in a known extra entry).
- **Compression tuning** — currently uses zip's default deflate level. Wasm doesn't compress dramatically (it's already binary), but the SDK could skip compression on the wasm entry to save ~50% packaging time on large plugins.

### Plugin marketplace 💭

Long-term: a directory of community plugins. Out of scope for now, but distribution decisions today (signing, manifest fields, permission grouping) influence what's possible later.

### Test binary distribution 🛠️

`owncast-plugin-test` is currently built locally and copied into `tools/`. Real release pipeline would publish per-platform binaries to a GitHub release; SDK postinstall fetches the right one (same pattern as `extism-js`/`binaryen`).

---

## Security

### HTTP allow-listing per plugin 💭

`network.fetch` currently grants any host (including localhost). For a marketplace-distribution future where admins can't fully audit every plugin, a manifest field could narrow this:

```json
{
  "network": {
    "allowedHosts": ["*.weather.com", "api.example.com"]
  }
}
```

Defense in depth against compromised plugins (supply chain). Not a real security boundary against a malicious original author. Defer until there's a clear marketplace story; see the design discussion in commit history for the full reasoning.

### Per-route admin auth declarations 💭

Today plugin HTTP endpoints default-public; plugins gate admin features by checking `req.authenticated`. A manifest declaration would let the host enforce auth before reaching the plugin:

```json
{
  "http": {
    "adminPaths": ["/admin/*"]
  }
}
```

The host returns 401 on those paths for unauthenticated requests; the plugin never sees them. Removes a class of "author forgot to check auth" bugs. Strongly worth doing alongside the admin UI integration above.

### Response signing for sensitive plugin endpoints 💭

If plugins expose webhook destinations (`POST /plugins/foo/webhook`), authors may want to verify the request came from an expected source. Today they'd have to validate any signature/secret themselves. A built-in HMAC-validation host function could help.

---

## Author UX

### Better error messages on load failure 🪲

Plugin load failures today print to stderr and the plugin is skipped. Improvements:

- Surface load failures in the admin UI, not just the log
- Group "this plugin failed to load" failures so admins see *which* plugin and *why* in one place
- Suggest remediation when the cause is recognizable (manifest API version mismatch, missing permission for a declared feature, etc.)

### Typed config schema in the manifest 💭

```json
{
  "config": {
    "wordlist": {
      "type": "string[]",
      "default": [],
      "description": "Words to redact"
    },
    "apiKey": {
      "type": "string",
      "secret": true,
      "description": "OpenAI API key"
    }
  }
}
```

Owncast admin auto-renders a config form. Plugin reads values via `owncast.config.get("wordlist")`. Cleaner than every plugin building its own config UI for simple cases. Pairs with the admin UI integration: simple plugins use the auto-form; complex ones ship custom HTML.

### Hot reload of the plugin during `npm run serve` 💭

Currently the dev server loads the plugin once. Edit code → rebuild → restart serve. A file watcher that rebuilds + reloads the plugin in place would cut iteration time significantly.

### Better template — more starting points 🛠️

`create-owncast-plugin` ships one starter template. Worth offering `--template` options for common patterns: `chat-bot`, `filter`, `overlay`, `admin-page`. Authors pick the closest match and edit from there.

---

## Host API expansion

The [HOST_API_ROADMAP.md](./HOST_API_ROADMAP.md) document tracks every host function and event to expose as the plugin runtime gets wired into real Owncast. Status as of latest update:

**Shipped:**
- Native event handlers: `onStreamStarted/Stopped/TitleChanged`, `onChatUserJoined/Parted/Renamed`, `onMessageModerated`, `onFediverseFollow/Like/Repost`
- Read APIs: `owncast.stream.current()`, `owncast.server.info()`
- Chat: `owncast.chat.send/sendAction/sendAs/history/deleteMessage/kick`
- Notifications: `owncast.notifications.discord/browserPush`

**Still pending:**
- User APIs: `owncast.users.list()`, `.setEnabled()`, `.banIP()` — needs `users.moderate` permission
- `owncast.chat.clients()` — list connected chat clients
- `owncast.storage.upload()` for plugin-uploaded assets backed by Owncast's local/S3 storage
- `owncast.notifications.fediverse({type, body})`
- `owncast.server.socials()`, `.federation()`, `.streamConfig()` — additional read APIs

Each remaining item is mostly mechanical once Owncast integration is happening — Owncast already has the underlying functions; the work is wrapping them as host imports.

---

## Real Owncast integration

The PoC's `host-runtime-poc/main.go` and `host-runtime-poc/cmd/owncast-plugin-serve` are stand-ins for the production host. Integration into real Owncast involves:

### Mount the plugin server in chi 🛠️

```go
mux.Handle("/plugins/", pluginServer)
```

In Owncast's existing chi router. One line.

### Wire `req.authenticated` and `req.user` 🛠️

Today always `false` / undefined. In production, populate from Owncast's existing auth middleware results:

```ts
interface IncomingHttpRequest {
  // ...existing
  authenticated: boolean;     // any auth, admin or user
  user?: {
    id: string;
    displayName: string;
    scopes: string[];
    isBot: boolean;
  };
  isAdmin: boolean;
}
```

See `webserver/router/middleware/auth.go` for the three middleware layers.

### Bridge webhook events to plugin events 🛠️

Owncast's webhook dispatcher fires events like `StreamStarted`. Wrap that dispatcher so it also calls into the plugin dispatcher. Cleanest if both go through a shared event bus.

### KV backend choice 💭

Current KV is bbolt. When integrated, KV could move to SQLite (alongside Owncast's existing data) or stay separate. Decision affects backup story (one file vs two) and migration tooling. SQLite probably wins for operational simplicity.

### Plugin loading lifecycle ✅ (two-tier state shipped)

The Manager now tracks plugins in two states: **discovered** (any parseable file in `plugins/`) and **loaded** (admin has explicitly enabled it). Files are auto-detected by a 2-second scan loop — but never auto-loaded. The admin clicks Enable to instantiate. Disable unloads but keeps the entry visible. Reload rotates the wasm without a restart.

- ✅ Startup load — `Manager.Start(ctx)` does an initial scan and auto-loads anything in the persisted enabled set.
- ✅ Admin "reload plugins" — `Manager.Reload(ctx, name)` rotates a single plugin.
- ✅ Hot detect on file change — scan loop picks up new files; admin still has to enable them.
- ✅ Per-plugin enable/disable from admin — `Manager.Enable / Disable / List` with persistence.

Persistence currently writes `<pluginsDir>/.enabled.json`. When wiring into real Owncast, swap this for the native config store. See [memory: project-enabled-persistence].

### Plugin install/uninstall flow from admin UI 💭

A picture of how a plugin gets installed:

- Admin drops `.wasm` + `.manifest.json` in `plugins/` directory (today's only way)
- Admin uploads through the admin UI — Owncast validates manifest, prompts for permission grants, stores files
- Admin installs from a URL or marketplace (future)

(2) is probably the right v1 admin flow once admin integration lands. (3) is marketplace territory.

---

## Quick wins (small but valuable)

- 🪲 Test runner's `chatSends: []` vs `nil` slice equivalence already fixed; verify same handling for `emits`, `httpRequests` (current code uses length checks so should be OK, but worth a regression test).
- 🛠️ Add a `--version` flag to `owncast-plugin-test` and `owncast-plugin-serve`.
- 🛠️ `owncast-plugin doctor` subcommand that validates a project: manifest is well-formed, source compiles, declared permissions match what the code uses, etc. Like `npm doctor` for plugins.
- 🛠️ Print a one-line summary at the end of `npm test`: `7/7 passed in 4.2s`. Currently just prints results inline.
- 🪲 `console.log` in plugin code currently double-tags the plugin name when used naively with the host logger. Minor cleanup possible.
