// slugify mirrors the host's Go slugify and the Python SDK's: ASCII letters and
// digits pass through lowercased, everything else collapses to a single hyphen,
// and trailing hyphens are trimmed. Shared by the build CLI and the JS test API
// so a manifest that omits `slug` resolves to the same `<slug>.js` artifact name
// everywhere. Non-ASCII names (e.g. "Café") degrade noisily (-> "caf"), so pin
// `slug` in the manifest for accented or non-Latin display names.
function slugify(input) {
  let out = "";
  let prevHyphen = false;
  for (const ch of input) {
    const code = ch.codePointAt(0);
    let lower = ch;
    if (code >= 65 && code <= 90) lower = String.fromCodePoint(code + 32);
    const lc = lower.codePointAt(0);
    if ((lc >= 97 && lc <= 122) || (lc >= 48 && lc <= 57)) {
      out += lower;
      prevHyphen = false;
    } else if (!prevHyphen && out.length > 0) {
      out += "-";
      prevHyphen = true;
    }
  }
  return out.replace(/-+$/, "");
}

module.exports = { slugify };
