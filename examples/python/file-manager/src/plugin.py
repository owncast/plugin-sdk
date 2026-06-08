# file-manager, a worked example of the storage.fs permission.
#
# It serves an admin-only page that lists the files in this plugin's
# private sandbox (data/plugin-data/file-manager/), lets you upload new
# ones, and delete existing ones. Everything goes through the owncast.fs.*
# API, so the host confines every path to the plugin's own directory.
#
# Routes (all the /admin/* ones are auth-gated by the host before the
# plugin ever sees them, so the handler never checks auth itself):
#   GET  /                          , public landing page
#   GET  /admin/                    , the file-manager UI
#   GET  /admin/api/files           , list file names
#   POST /admin/api/files           , upload  { name, dataBase64 }
#   POST /admin/api/files/delete    , delete  { name }
#   GET  /admin/api/files/download  , download ?name=<n> -> { name, dataBase64 }
import base64
import binascii
import json

from owncast_plugin import plugin, owncast


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


# The UI uses flat file names; the host would sandbox a path either way, but
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


def list_files():
    # "" lists the sandbox root.
    return json_resp(200, {"files": owncast.fs.list("")})


def upload_file(req):
    try:
        parsed = json.loads(req.body)
    except (ValueError, TypeError):
        return json_resp(400, {"ok": False, "error": "invalid JSON"})
    name = parsed.get("name")
    if bad_name(name):
        return json_resp(400, {"ok": False, "error": "invalid file name"})
    # owncast.fs.exists lets us tell the admin whether they replaced a file.
    replaced = owncast.fs.exists(name)
    result = owncast.fs.write(name, b64decode(parsed.get("dataBase64") or ""))
    if not (result and result.get("ok")):
        err = (result or {}).get("error") or "write failed"
        return json_resp(500, {"ok": False, "error": err})
    return json_resp(200, {"ok": True, "replaced": replaced})


def delete_file(req):
    try:
        parsed = json.loads(req.body)
    except (ValueError, TypeError):
        return json_resp(400, {"ok": False, "error": "invalid JSON"})
    if bad_name(parsed.get("name")):
        return json_resp(400, {"ok": False, "error": "invalid file name"})
    result = owncast.fs.delete(parsed.get("name"))
    if not (result and result.get("ok")):
        err = (result or {}).get("error") or "delete failed"
        return json_resp(500, {"ok": False, "error": err})
    return json_resp(200, {"ok": True})


def download_file(req):
    query = req.raw.get("query") or {}
    name = query.get("name") if isinstance(query, dict) else None
    if bad_name(name):
        return json_resp(400, {"ok": False, "error": "invalid file name"})
    data = owncast.fs.read(name)
    if data is None:
        return json_resp(404, {"ok": False, "error": "not found"})
    return json_resp(200, {"name": name, "dataBase64": b64encode(data)})


@plugin.get("/admin/api/files")
def files_list(req):
    return list_files()


@plugin.post("/admin/api/files")
def files_upload(req):
    return upload_file(req)


@plugin.post("/admin/api/files/delete")
def files_delete(req):
    return delete_file(req)


# Download routes on the path only; the ?name=<n> query string is excluded from
# matching and read from req.raw["query"] inside download_file.
@plugin.get("/admin/api/files/download")
def files_download(req):
    return download_file(req)
