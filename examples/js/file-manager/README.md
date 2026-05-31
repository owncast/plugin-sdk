# file-manager

An admin page that browses, uploads, and deletes files in the plugin's own
private sandbox at `data/plugin-data/file-manager/`, all through the
`owncast.fs.*` API. The admin routes are gated by the host before the plugin
sees them, so the handler never checks auth itself.

**Demonstrates:** the `storage.fs` permission end to end —
`owncast.fs.list` (browse), `owncast.fs.write` + `owncast.fs.exists` (upload,
reporting whether a file was replaced), `owncast.fs.read` (download), and
`owncast.fs.delete` (remove). Binary files cross the string-typed HTTP body
base64-encoded; the plugin carries a tiny dependency-free base64 codec since
the wasm runtime doesn't guarantee `atob`/`btoa`.

Unlike `storage.upload`, these files stay server-side — they are never served
over HTTP. The host confines every path to this plugin's own directory, so a
plugin can't read another plugin's files or escape its sandbox.
