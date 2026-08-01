const Mustache = require("mustache");
const { Marked } = require("marked");
const { definePlugin, owncast } = require("@owncast/plugin-sdk");

const rulesKey = "rules";
const settingsKey = "settings";
const updatedKey = "updatedAt";
const maxRuleLength = 1000;
const maxTabNameLength = 24;
const maxRulesChatLength = 1200;
const defaultSettings = {
  tabName: "Rules",
  title: "Before you join the conversation",
  description: "Please take a moment to understand what this community expects from everyone who participates.",
  footer: "Thanks for helping make this a good place to spend time.",
  requireAcceptance: false,
};

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// updatedAt is stored as an ISO-8601 timestamp. Format it from its own parts
// rather than through Intl, which the plugin engine does not ship.
function formatUpdated(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return "";
  const [, year, month, day] = match;
  const name = months[Number(month) - 1];
  return name ? `${name} ${Number(day)}, ${year}` : "";
}

const templates = {};
function asset(name) {
  if (!templates[name]) templates[name] = owncast.assets.readText(name);
  return templates[name];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value) {
  const href = String(value || "").trim();
  return /^(https?:|mailto:|\/(?!\/)|#)/i.test(href) ? href : "";
}

const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safe = safeHref(href);
      if (!safe) return label;
      const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(safe)}"${titleAttribute} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image({ text }) {
      return `<span class="muted rules-image-alt">Image: ${escapeHtml(text || "untitled")}</span>`;
    },
  },
});

function renderInlineMarkdown(value) {
  return markdown.parseInline(value).trim();
}

function renderMarkdown(value) {
  return markdown.parse(value).trim();
}

function readRules() {
  try {
    const stored = JSON.parse(owncast.kv.get(rulesKey) || "[]");
    return Array.isArray(stored) ? stored.filter((rule) => typeof rule === "string") : [];
  } catch (_) {
    return [];
  }
}

function readSettings() {
  let stored = {};
  try {
    stored = JSON.parse(owncast.kv.get(settingsKey) || "{}");
  } catch (_) {
    stored = {};
  }

  return {
    tabName: typeof stored.tabName === "string" ? stored.tabName : defaultSettings.tabName,
    title: typeof stored.title === "string" ? stored.title : defaultSettings.title,
    description: typeof stored.description === "string" ? stored.description : defaultSettings.description,
    footer: typeof stored.footer === "string" ? stored.footer : defaultSettings.footer,
    requireAcceptance: stored.requireAcceptance === true,
    rules: readRules(),
  };
}

function validateSettings(value) {
  const tabName =
    typeof value?.tabName === "string"
      ? value.tabName.replace(/\s+/g, " ").trim()
      : defaultSettings.tabName;
  const title = typeof value?.title === "string" ? value.title.trim() : defaultSettings.title;
  const description =
    typeof value?.description === "string" ? value.description.trim() : defaultSettings.description;
  const footer = typeof value?.footer === "string" ? value.footer.trim() : defaultSettings.footer;
  const requireAcceptance = value?.requireAcceptance === true;

  if (
    !tabName ||
    tabName.length > maxTabNameLength ||
    /[\u0000-\u001f\u007f]/.test(tabName) ||
    !title ||
    title.length > 120 ||
    description.length > 1000 ||
    footer.length > 500
  ) {
    return null;
  }
  return { tabName, title, description, footer, requireAcceptance };
}

function validateRules(value) {
  if (!Array.isArray(value)) return null;

  const rules = value.map((rule) => (typeof rule === "string" ? rule.trim() : ""));
  if (rules.some((rule) => !rule || rule.length > maxRuleLength)) return null;
  return rules;
}

function renderRules(settings) {
  const { title, description, footer, rules } = settings;
  return Mustache.render(asset("rules.mustache"), {
    styles: asset("rules.css"),
    titleHtml: renderInlineMarkdown(title),
    descriptionHtml: description ? renderMarkdown(description) : "",
    footerHtml: footer && rules.length ? renderMarkdown(footer) : "",
    updatedLabel: rules.length ? formatUpdated(owncast.kv.get(updatedKey)) : "",
    hasRules: rules.length > 0,
    rules: rules.map((rule, index) => ({
      number: String(index + 1).padStart(2, "0"),
      html: renderMarkdown(rule),
    })),
  });
}

function renderAcceptanceDialog(settings) {
  return Mustache.render(asset("accept.mustache"), {
    tabName: settings.tabName,
    titleHtml: renderInlineMarkdown(settings.title),
    descriptionHtml: settings.description ? renderMarkdown(settings.description) : "",
    footerHtml: settings.footer && settings.rules.length ? renderMarkdown(settings.footer) : "",
    rules: settings.rules.map((rule, index) => ({
      number: String(index + 1).padStart(2, "0"),
      html: renderMarkdown(rule),
    })),
  });
}

function acceptanceScript(settings) {
  if (!settings.requireAcceptance || !settings.rules.length) return "";
  const markup = JSON.stringify(renderAcceptanceDialog(settings)).replace(/</g, "\\u003c");
  const version = JSON.stringify(
    owncast.kv.get(updatedKey) ||
      JSON.stringify({
        title: settings.title,
        description: settings.description,
        footer: settings.footer,
        rules: settings.rules,
      }),
  ).replace(/</g, "\\u003c");
  return `(function () {
  var storageKey = 'owncast-rules-accepted-version';
  var version = ${version};
  try {
    if (localStorage.getItem(storageKey) === version) return;
  } catch (_) {}
  if (document.getElementById('owncast-rules-gate')) return;
  var holder = document.createElement('div');
  holder.innerHTML = ${markup};
  var gate = holder.firstElementChild;
  if (!gate) return;
  document.body.appendChild(gate);
  document.documentElement.classList.add('owncast-rules-gate-open');
  var accept = gate.querySelector('[data-accept-rules]');
  accept.addEventListener('click', function () {
    try { localStorage.setItem(storageKey, version); } catch (_) {}
    gate.remove();
    document.documentElement.classList.remove('owncast-rules-gate-open');
  });
  gate.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') event.preventDefault();
    if (event.key === 'Tab') {
      event.preventDefault();
      accept.focus();
    }
  });
  accept.focus();
})();`;
}


function rulesChatMessage(settings) {
  const heading = `**${settings.tabName}:**

`;
  if (!settings.rules.length) {
    return `No ${settings.tabName.toLowerCase()} have been published yet.`;
  }

  const suffix = `
Open the ${settings.tabName} tab for the complete list.`;
  const lines = [];
  for (let index = 0; index < settings.rules.length; index += 1) {
    const rule = settings.rules[index].replace(/\s+/g, " ").trim();
    const line = `**${String(index + 1).padStart(2, "0")}.** ${rule}  `;
    const candidate = heading + [...lines, line].join("\n");
    if (candidate.length > maxRulesChatLength) {
      if (!lines.length) {
        const available = Math.max(0, maxRulesChatLength - heading.length - suffix.length - 1);
        lines.push(`${line.slice(0, Math.max(0, available - 1)).trimEnd()}…`);
      }
      return heading + lines.join("\n") + suffix;
    }
    lines.push(line);
  }
  return heading + lines.join("\n");
}



function tabNameScript(tabName) {
  const label = JSON.stringify(tabName).replace(/</g, "\\u003c");
  return `(function () {
  var label = ${label};
  function renameRulesTab() {
    document.querySelectorAll('[role="tab"]').forEach(function (tab) {
      var identity = (tab.id || '') + ' ' + (tab.getAttribute('aria-controls') || '');
      if (identity.indexOf('plugin-rules-') === -1) return;
      var target = tab.querySelector('.ant-tabs-tab-btn') || tab;
      if (target.textContent !== label) target.textContent = label;
    });
  }
  if (window.__owncastRulesTabNameObserver) window.__owncastRulesTabNameObserver.disconnect();
  renameRulesTab();
  window.__owncastRulesTabNameObserver = new MutationObserver(renameRulesTab);
  window.__owncastRulesTabNameObserver.observe(document.body, { childList: true, subtree: true });
})();`;
}

module.exports = definePlugin({
  commands: {
    rules: {
      description: "Show the community rules",
      cooldownMs: 10_000,
      run(ctx) {
        ctx.reply(rulesChatMessage(readSettings()));
      },
    },
  },

  onTabContent({ slug }) {
    return slug === "rules" ? renderRules(readSettings()) : "";
  },

  onPageStyles() {
    const settings = readSettings();
    const hideRulesTab = settings.rules.length
      ? ""
      : '.ant-tabs-tab:has([role="tab"][aria-controls*="plugin-rules-"]) { display: none !important; }\n[role="tabpanel"][id*="plugin-rules-"] { display: none !important; }\n';
    return `${hideRulesTab}${settings.requireAcceptance ? asset("accept.css") : ""}`;
  },
 
  onPageScripts() {
    const settings = readSettings();
    return `${tabNameScript(settings.tabName)}
${acceptanceScript(settings)}`;
  },


  onHttpRequest(req) {
    if (req.path !== "/admin/api/rules") return { status: 404 };
    if (!req.authenticated) return { status: 401 };

    if (req.method === "GET") {
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(readSettings()),
      };
    }

    if (req.method === "PUT") {
      let parsed;
      try {
        parsed = JSON.parse(req.body);
      } catch (_) {
        return { status: 400, body: "Rules must be valid JSON." };
      }

      const rules = validateRules(parsed?.rules);
      const settings = validateSettings(parsed);
      if (!rules || !settings) {
        return {
          status: 400,
          body: `Provide a tab name and title. Each rule must contain text and be at most ${maxRuleLength} characters.`,
        };
      }
      if (settings.requireAcceptance && !rules.length) {
        return { status: 400, body: "Add at least one rule before requiring viewers to accept them." };
      }
      const previous = readSettings();
      const visibleContentChanged =
        previous.title !== settings.title ||
        previous.description !== settings.description ||
        previous.footer !== settings.footer ||
        JSON.stringify(previous.rules) !== JSON.stringify(rules);

      owncast.kv.set(rulesKey, JSON.stringify(rules));
      owncast.kv.set(settingsKey, JSON.stringify(settings));
      if (visibleContentChanged) owncast.kv.set(updatedKey, new Date().toISOString());
      return { status: 204 };
    }

    return { status: 405 };
  },
});
