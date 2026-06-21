// Host-import union for the shared JS engine. Unlike per-plugin builds (which
// only import the host functions a plugin's permissions grant), the shared
// engine imports the FULL set. The host registers all of them once and gates
// each by the calling plugin's permissions at call time. This list must stay
// in sync with Owncast's BuildHostFunctions (services/plugins/hostfns.go).
declare module 'main' {
  export function register(): I32;
  export function on_event(): I32;
  export function on_filter(): I32;
  export function on_http_request(): I32;
  export function on_auth_check(): I32;
  export function on_tab_content(): I32;
  export function on_page_content(): I32;
  export function on_page_styles(): I32;
  export function on_page_scripts(): I32;
}

declare module 'extism:host' {
  interface user {
    owncast_timer_set(id: I64, delayMs: I64, repeat: I64): I64;
    owncast_timer_clear(id: I64): void;
    owncast_config_get(keyPtr: PTR): PTR;
    owncast_asset_read(pathPtr: PTR): PTR;
    owncast_send_chat(textPtr: PTR): void;
    owncast_send_chat_action(textPtr: PTR): void;
    owncast_send_chat_system(bodyPtr: PTR): void;
    owncast_send_chat_to(clientId: I64, textPtr: PTR): void;
    owncast_chat_history(limit: I64): PTR;
    owncast_chat_clients(): PTR;
    owncast_delete_message(idPtr: PTR): void;
    owncast_kick_client(clientId: I64): void;
    owncast_notify_discord(textPtr: PTR): void;
    owncast_notify_browser_push(payloadPtr: PTR): void;
    owncast_notify_fediverse(payloadPtr: PTR): void;
    owncast_users_list(): PTR;
    owncast_user_get(idPtr: PTR): PTR;
    owncast_users_register(reqPtr: PTR): PTR;
    owncast_auth_grant_session(reqPtr: PTR): PTR;
    owncast_auth_end_session(): void;
    owncast_user_set_enabled(idPtr: PTR, enabled: I64, reasonPtr: PTR): void;
    owncast_ban_ip(ipPtr: PTR): void;
    owncast_storage_upload(namePtr: PTR, dataPtr: PTR): PTR;
    owncast_fs_read(pathPtr: PTR): PTR;
    owncast_fs_write(pathPtr: PTR, dataPtr: PTR): PTR;
    owncast_fs_list(dirPtr: PTR): PTR;
    owncast_fs_delete(pathPtr: PTR): PTR;
    owncast_fs_exists(pathPtr: PTR): I64;
    owncast_fediverse_post(textPtr: PTR): PTR;
    owncast_kv_get(keyPtr: PTR): PTR;
    owncast_kv_set(keyPtr: PTR, valPtr: PTR): void;
    owncast_emit_event(eventTypePtr: PTR, payloadPtr: PTR): void;
    owncast_sse_send(channelPtr: PTR, eventPtr: PTR, dataPtr: PTR): void;
    owncast_stream_current(): PTR;
    owncast_server_info(): PTR;
    owncast_server_socials(): PTR;
    owncast_server_emotes(): PTR;
    owncast_server_federation(): PTR;
    owncast_stream_broadcaster(): PTR;
    owncast_server_tags(): PTR;
    owncast_video_config_read(): PTR;
    owncast_video_config_write(configPtr: PTR): PTR;
    owncast_add_actions(actionsPtr: PTR): void;
    owncast_clear_actions(): void;
  }
}
