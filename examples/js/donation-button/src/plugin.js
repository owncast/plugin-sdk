const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const SETTINGS_KEY = "donation-settings";
const DEFAULT_TITLE = "Support the stream";
const DEFAULT_DESCRIPTION = "Send a donation on Ko-fi";
const DEFAULT_COLOR = "#29abe0";

function parseSettings(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function loadSettings() {
  return parseSettings(owncast.kv.get(SETTINGS_KEY));
}

function normalizeKoFiUrl(value) {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) return "";

  let normalized = input.replace(/^@+/, "");
  normalized = normalized.replace(/^https?:\/\/(www\.)?ko-fi\.com\//i, "");
  normalized = normalized.replace(/^ko-fi\.com\//i, "");
  normalized = normalized.replace(/^kofi\.com\//i, "");
  normalized = normalized.replace(/^https?:\/\/(www\.)?kofi\.com\//i, "");
  normalized = normalized.replace(/^\/+/, "");
  normalized = normalized.split(/[?#]/)[0].replace(/\/+$/, "");

  if (!normalized) return "";
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return null;

  return `https://ko-fi.com/${normalized}`;
}

function sanitizeColor(value) {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) return DEFAULT_COLOR;
  return /^#[0-9a-fA-F]{6}$/.test(input) ? input : null;
}

function buildSettings(payload) {
  const creator = typeof payload?.creator === "string" ? payload.creator.trim() : "";
  const buttonTitle = typeof payload?.buttonTitle === "string" ? payload.buttonTitle.trim() : "";
  const description = typeof payload?.description === "string" ? payload.description.trim() : "";
  const color = sanitizeColor(payload?.color);

  if (creator === "") {
    return {
      clear: true,
      settings: {
        creator: "",
        buttonTitle: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        color: DEFAULT_COLOR,
        url: "",
      },
    };
  }

  const url = normalizeKoFiUrl(creator);
  if (!url) {
    return { error: "Enter a valid Ko-fi username or URL." };
  }
  if (!color) {
    return { error: "Color must be a 6-digit hex value like #29abe0." };
  }

  return {
    clear: false,
    settings: {
      creator,
      buttonTitle: buttonTitle || DEFAULT_TITLE,
      description: description || DEFAULT_DESCRIPTION,
      color,
      url,
    },
  };
}

function currentFormState() {
  const settings = loadSettings();
  if (!settings) {
    return {
      creator: "",
      buttonTitle: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      color: DEFAULT_COLOR,
      url: "",
    };
  }
  return {
    creator: settings.creator || "",
    buttonTitle: settings.buttonTitle || DEFAULT_TITLE,
    description: settings.description || DEFAULT_DESCRIPTION,
    color: settings.color || DEFAULT_COLOR,
    url: settings.url || normalizeKoFiUrl(settings.creator || "") || "",
  };
}

function publishAction(settings) {
  owncast.actions.clear();
  if (!settings || !settings.url) return;
  owncast.actions.add({
    title: settings.buttonTitle,
    description: settings.description,
    url: settings.url,
    color: settings.color,
    openExternally: true,
  });
}

module.exports = definePlugin({
  onHttpRequest(req) {
    if (req.method === "GET" && req.path === "/admin/api/settings") {
      const state = currentFormState();
      // Re-publish the saved action so the host's runtime button state stays in
      // sync with what this plugin has persisted.
      publishAction(state);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state),
      };
    }

    if (req.method === "POST" && req.path === "/admin/api/settings") {
      let payload;
      try {
        payload = JSON.parse(req.body);
      } catch (_error) {
        return { status: 400, body: "invalid JSON" };
      }

      const result = buildSettings(payload);
      if (result.error) {
        return { status: 400, body: result.error };
      }

      if (result.clear) {
        if (owncast.kv.delete) owncast.kv.delete(SETTINGS_KEY);
        owncast.kv.set(SETTINGS_KEY, "");
        owncast.actions.clear();
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(result.settings),
        };
      }

      owncast.kv.set(SETTINGS_KEY, JSON.stringify(result.settings));
      publishAction(result.settings);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(result.settings),
      };
    }

    return { status: 404 };
  },
});
