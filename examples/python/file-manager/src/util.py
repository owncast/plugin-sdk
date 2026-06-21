# Pure helpers for file-manager: base64 codec, file-name validation, and JSON
# response shaping. None of them touch the owncast API, so they live in their
# own module, imported by plugin.py.
import base64
import binascii
import json

__all__ = ["b64decode", "b64encode", "bad_name", "json_resp"]


def b64decode(value):
    s = "" if value is None else str(value)
    # Tolerate missing padding, mirroring the JS codec's leniency.
    s += "=" * (-len(s) % 4)
    try:
        return base64.b64decode(s)
    except (binascii.Error, ValueError):
        return b""


def b64encode(data):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.b64encode(data).decode("ascii")


# The UI uses flat file names. The host would sandbox a path either way, but
# keeping names flat avoids surprising the listing. Reject anything with a
# path separator or a bare dot.
def bad_name(name):
    return (
        not name
        or not isinstance(name, str)
        or "/" in name
        or "\\" in name
        or name == "."
        or name == ".."
    )


def json_resp(status, obj):
    return {
        "status": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(obj, separators=(",", ":")),
    }
