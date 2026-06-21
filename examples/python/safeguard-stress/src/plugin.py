# safeguard-stress: misbehaves on demand to exercise host sandbox limits.
# Each handler dispatches on the payload `cmd` field. Tests in
# owncast/plugin/manager_safeguards_test.go drive these branches.

from owncast_plugin import plugin, filter


def huge_string(num_bytes):
    return "x" * num_bytes


# Pre-built at module-load so the handlers return them instantly. Building
# multi-MB strings inside a 50ms filter call would otherwise hit the per-call
# timeout before we got to test the output-size cap.
# Sized just over each cap so the handler can serialize and return the
# payload within the per-call timeout. The tests want the *size* check to
# fire, not the timeout. (MaxFilterOutputBytes = 1 MiB, we send 1.1 MiB.
# MaxHTTPHandlerOutputBytes = 12 MiB, HTTP test has a 5s call cap so 13 MiB
# is fine there.)
HUGE_FILTER_BODY = huge_string(1126400)  # ~1.075 MiB, > 1 MiB cap
HUGE_HTTP_BODY = huge_string(13 * 1024 * 1024)


@plugin.filter_chat_message
def stress_filter(msg):
    cmd = msg.cmd if msg else None
    if cmd == "spin":
        # Tight loop, bounded by the host's per-filter timeout.
        while True:
            pass
    if cmd == "huge-output":
        # Return a payload larger than MaxFilterOutputBytes (1 MiB).
        return filter.modify({"body": HUGE_FILTER_BODY})
    if cmd == "alloc":
        # Try to allocate more wasm memory than MaxWasmPages allows.
        # Holding the reference forces actual growth.
        _hold = bytearray(80 * 1024 * 1024)  # 80 MiB  # noqa: F841
        return filter.pass_()
    return filter.pass_()


@plugin.on_chat_message
def stress_notify(msg):
    cmd = msg.cmd if msg else None
    if cmd == "spin":
        while True:
            pass
    # No-op. Existence of the handler is enough to test the timeout
    # wrapping path.
    return


# The two known stress commands get exact-path routes (any method, since the
# original dispatched on path alone). They're registered with the path-only
# form of on_http_request rather than @plugin.get/@plugin.post so a mismatched
# method still reaches them instead of auto-405ing.
@plugin.on_http_request("/spin")
def stress_http_spin(req):
    # Tight loop, bounded by the host's per-handler timeout.
    while True:
        pass


@plugin.on_http_request("/huge")
def stress_http_huge(req):
    return {"status": 200, "body": HUGE_HTTP_BODY}  # > MaxHTTPHandlerOutputBytes


# Catch-all kept on purpose: this plugin stress-tests the host by being driven
# at arbitrary/synthetic paths, and every other path must answer "ok". Routing
# can't enumerate those, so the bare fallback stays.
@plugin.on_http_request
def stress_http(req):
    return {"status": 200, "body": "ok"}
