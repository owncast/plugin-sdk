//! Hello Wasm is an Owncast plugin authored directly as a self-contained wasm
//! module. There is no JavaScript/Python SDK and no shared engine here: this
//! crate implements the wire protocol (`docs/WIRE_PROTOCOL.md`) itself, with
//! two exports and one host import.
//!
//! The interesting part is `MANIFEST_KEY`. The host injects the packaged
//! `plugin.manifest.json` under that reserved Extism config key on every
//! runtime, so a hand-written module reads its own identity and metadata back
//! from the host instead of compiling in a second copy that drifts from
//! whatever actually shipped in the `.ocpkg`.

use extism_pdk::*;
use serde_json::Value;

/// Reserved Extism config key holding the packaged manifest JSON. Its sibling
/// `__slug` carries the host-resolved slug, which is the authoritative identity
/// when a manifest leaves `slug` out and lets the host derive it from `name`.
const MANIFEST_KEY: &str = "manifest";

#[host_fn]
extern "ExtismHost" {
    /// `chat.send`: post to chat as this plugin's bot identity.
    fn owncast_send_chat(text: String);
}

/// The host calls `register` once at load. It expects the manifest back with
/// the runtime's subscriptions and command declarations filled in. A language
/// SDK derives those from the handlers an author registered. With no SDK here,
/// they're declared in `plugin.manifest.json`, so echoing the injected manifest
/// verbatim is the whole implementation.
///
/// The host compares the echoed slug and permissions against the sidecar
/// manifest it parsed, so a plugin that invents its own answer here fails to
/// load.
#[plugin_fn]
pub fn register() -> FnResult<String> {
    Ok(manifest_json()?)
}

/// Notification dispatch. Input is the `{eventType, payload}` envelope. The
/// host only sends events the manifest subscribed to, but checking the type
/// keeps the handler honest as subscriptions grow.
#[plugin_fn]
pub fn on_event(envelope: String) -> FnResult<()> {
    let envelope: Value = serde_json::from_str(&envelope)?;
    if envelope["eventType"] != "chat.message.received" {
        return Ok(());
    }

    let manifest: Value = serde_json::from_str(&manifest_json()?)?;
    let message = &envelope["payload"];
    let sender = message["user"]["displayName"].as_str().unwrap_or("someone");
    let reply = format!(
        "{} v{} heard {} say: {}",
        manifest["name"].as_str().unwrap_or("plugin"),
        manifest["version"].as_str().unwrap_or("0"),
        sender,
        message["body"].as_str().unwrap_or(""),
    );

    unsafe { owncast_send_chat(reply)? };
    Ok(())
}

fn manifest_json() -> Result<String, Error> {
    config::get(MANIFEST_KEY)?.ok_or_else(|| {
        Error::msg(format!(
            "host set no {MANIFEST_KEY:?} config value (Owncast older than the release that injects it for wasm plugins)"
        ))
    })
}
