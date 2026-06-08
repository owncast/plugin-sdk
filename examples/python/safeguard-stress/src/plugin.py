# safeguard-stress: misbehaves on demand to exercise host sandbox limits.
# Each handler dispatches on the payload `cmd` field. Tests in
# owncast/plugin/manager_safeguards_test.go drive these branches.

from owncast_plugin import plugin, filter


def huge_string(num_bytes):
    return "x" * num_bytes


# Pre-built at module-load so the handlers return them instantly; building
# multi-MB strings inside a 50ms filter call would otherwise hit the per-call
# timeout before we got to test the output-size cap.
# Sized just over each cap so the handler can serialize and return the
# payload within the per-call timeout; the tests want the *size* check to
# fire, not the timeout. (MaxFilterOutputBytes = 1 MiB; we send 1.1 MiB.
# MaxHTTPHandlerOutputBytes = 12 MiB; HTTP test has a 5s call cap so 13 MiB
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
    # No-op; existence of the handler is enough to test the timeout
    # wrapping path.
    return


@plugin.on_http_request
def stress_http(req):
    # Path is "/<cmd>". Examples: /spin, /huge.
    cmd = (req.path or "/")[1:]
    if cmd == "spin":
        while True:
            pass
    if cmd == "huge":
        return {"status": 200, "body": HUGE_HTTP_BODY}  # > MaxHTTPHandlerOutputBytes
    return {"status": 200, "body": "ok"}
