// file-manager, a worked example of the storage.fs permission.
//
// It serves an admin-only page that lists the files in this plugin's
// private sandbox (data/plugin-data/file-manager/), lets you upload new
// ones, and delete existing ones. Everything goes through the owncast.fs.*
// API, so the host confines every path to the plugin's own directory.
//
// Routes (all the /admin/* ones are auth-gated by the host before the
// plugin ever sees them, so the handler never checks auth itself):
//   GET  /                          , public landing page
//   GET  /admin/                    , the file-manager UI
//   GET  /admin/api/files           , list file names
//   POST /admin/api/files           , upload  { name, dataBase64 }
//   POST /admin/api/files/delete    , delete  { name }
//   GET  /admin/api/files/download  , download ?name=<n> -> { name, dataBase64 }
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

// The HTTP body is a string, so binary files cross the wire base64-encoded.
// extism-js (QuickJS) doesn't guarantee atob/btoa, so we carry our own tiny,
// dependency-free base64 codec rather than rely on a runtime global.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64decode(input) {
  const str = String(input).replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  for (let i = 0; i < str.length; i += 4) {
    const n =
      (B64.indexOf(str[i]) << 18) |
      (B64.indexOf(str[i + 1]) << 12) |
      ((i + 2 < str.length ? B64.indexOf(str[i + 2]) : 0) << 6) |
      (i + 3 < str.length ? B64.indexOf(str[i + 3]) : 0);
    out.push((n >> 16) & 0xff);
    if (i + 2 < str.length) out.push((n >> 8) & 0xff);
    if (i + 3 < str.length) out.push(n & 0xff);
  }
  return new Uint8Array(out);
}

function b64encode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b1 >> 2];
    out += B64[((b1 & 3) << 4) | (b2 >> 4)];
    out += i + 1 < bytes.length ? B64[((b2 & 15) << 2) | (b3 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b3 & 63] : "=";
  }
  return out;
}

// The UI uses flat file names; the host would sandbox a path either way, but
// keeping names flat avoids surprising the listing. Reject anything with a
// path separator or a bare dot.
function badName(name) {
  return (
    !name ||
    typeof name !== "string" ||
    name.includes("/") ||
    name.includes("\\") ||
    name === "." ||
    name === ".."
  );
}

function json(status, obj) {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(obj),
  };
}

function listFiles() {
  // "" lists the sandbox root.
  return json(200, { files: owncast.fs.list("") });
}

function uploadFile(req) {
  let parsed;
  try {
    parsed = JSON.parse(req.body);
  } catch (e) {
    return json(400, { ok: false, error: "invalid JSON" });
  }
  const { name, dataBase64 } = parsed;
  if (badName(name)) {
    return json(400, { ok: false, error: "invalid file name" });
  }
  // owncast.fs.exists lets us tell the admin whether they replaced a file.
  const replaced = owncast.fs.exists(name);
  const result = owncast.fs.write(name, b64decode(dataBase64 || ""));
  if (!result.ok) {
    return json(500, { ok: false, error: result.error || "write failed" });
  }
  return json(200, { ok: true, replaced });
}

function deleteFile(req) {
  let parsed;
  try {
    parsed = JSON.parse(req.body);
  } catch (e) {
    return json(400, { ok: false, error: "invalid JSON" });
  }
  if (badName(parsed.name)) {
    return json(400, { ok: false, error: "invalid file name" });
  }
  const result = owncast.fs.delete(parsed.name);
  if (!result.ok) {
    return json(500, { ok: false, error: result.error || "delete failed" });
  }
  return json(200, { ok: true });
}

function downloadFile(req) {
  const name = req.query.name;
  if (badName(name)) {
    return json(400, { ok: false, error: "invalid file name" });
  }
  const bytes = owncast.fs.read(name);
  if (bytes == null) {
    return json(404, { ok: false, error: "not found" });
  }
  return json(200, { name, dataBase64: b64encode(bytes) });
}

module.exports = definePlugin({
  onHttpRequest(req) {
    if (req.path === "/admin/api/files") {
      if (req.method === "GET") return listFiles();
      if (req.method === "POST") return uploadFile(req);
      return { status: 405 };
    }
    if (req.path === "/admin/api/files/delete" && req.method === "POST") {
      return deleteFile(req);
    }
    if (req.path === "/admin/api/files/download" && req.method === "GET") {
      return downloadFile(req);
    }
    return { status: 404 };
  },
});
