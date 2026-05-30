# manual-video-settings

Admin-only form at `/plugins/manual-video-settings/admin/` for hand-editing the host's transcoding config: HLS latency level, output codec, and each output variant's resolution / framerate / video bitrate (plus the passthrough flag). The form reads the current state via `owncast.videoConfig.read()` and POSTs partial updates through `owncast.videoConfig.write()`.

**Demonstrates:** combining `manifest.admin.pages` (host-gated routes, no auth code in the plugin) with the `videoconfig.read` / `videoconfig.write` permission split. The HTTP handler accepts a partial `VideoConfigUpdate` so fields the form didn't touch are left untouched by the host.

```json
{
  "permissions": ["http.serve", "videoconfig.read", "videoconfig.write"],
  "admin": { "pages": [{ "title": "Manual Video Settings", "path": "/admin" }] }
}
```

Layout:

| Route                          | Behavior                                          |
| ------------------------------ | ------------------------------------------------- |
| `GET  /admin/`                 | Static HTML form (auth-gated by the host).        |
| `GET  /admin/api/config`       | Returns the current `VideoConfig` as JSON.        |
| `POST /admin/api/config`       | Applies a `VideoConfigUpdate`; 204 on success.    |

See [`stream-ops`](../stream-ops/) for the same APIs driven from chat commands instead of a UI, and [`admin-demo`](../admin-demo/) for the bare minimum admin-page pattern.
