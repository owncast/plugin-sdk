package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const SupportedAPIVersion = "1"

// slugPattern matches valid plugin slugs: lowercase letter start,
// followed by lowercase letters, digits, or hyphens, max 64 chars.
// The slug becomes the URL segment, KV namespace, on-disk filename,
// and registry primary key, so it has to stay narrow.
var slugPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)

type Subscription struct {
	Event    string `json:"event"`
	Priority int    `json:"priority,omitempty"`
}

type Subscriptions struct {
	Notify []Subscription `json:"notify,omitempty"`
	Filter []Subscription `json:"filter,omitempty"`
}

type ConfigField struct {
	Type        string `json:"type"`
	Default     any    `json:"default,omitempty"`
	Description string `json:"description,omitempty"`
}

type Manifest struct {
	API string `json:"api"`
	// DisplayName is the user-facing plugin name shown in admin lists,
	// registry browse cards, and (by default) as the in-chat bot
	// identity. JSON-tagged `name` for author ergonomics: authors
	// write `"name": "Awesome Echo Bot"` in their manifest and the Go
	// side treats it as a display string.
	DisplayName string `json:"name"`
	// Slug is the plugin's canonical identifier: URL segment, KV
	// namespace, on-disk filename, registry primary key. Lowercase,
	// hyphenated. Optional in source manifests, the SDK derives it
	// from DisplayName when omitted (see slugify). Authors who need
	// to pin a specific slug (e.g. for non-ASCII names) set it
	// explicitly.
	Slug          string                 `json:"slug,omitempty"`
	Version       string                 `json:"version"`
	Description   string                 `json:"description,omitempty"`
	Bot           BotConfig              `json:"bot,omitempty"`
	Subscriptions Subscriptions          `json:"subscriptions"`
	Permissions   []string               `json:"permissions,omitempty"`
	Config        map[string]ConfigField `json:"config,omitempty"`
	Admin         AdminConfig            `json:"admin,omitempty"`
	Actions       []ActionButton         `json:"actions,omitempty"`
	Network       NetworkConfig          `json:"network,omitempty"`
	// Styles is a list of CSS files the plugin contributes to the
	// viewer page (the public streaming page). Each entry is a path
	// relative to the plugin's own URL namespace: bare paths like
	// "theme.css" and "/theme.css" auto-prefix to
	// /plugins/<slug>/theme.css, fully-qualified plugin paths like
	// "/plugins/<slug>/theme.css" pass through as-is, and paths in
	// any other plugin's namespace are rejected. CSS injects into
	// the global scope, so a plugin author can restyle anything the
	// viewer page renders. Requires the ui.modify permission and the
	// plugin must ship the referenced files (typically under
	// `assets/`) with http.serve declared.
	Styles []string `json:"styles,omitempty"`
	// Scripts is a list of JavaScript files the plugin contributes
	// to the viewer page. Path rules and permission gating mirror
	// Styles: bare/relative paths auto-prefix to /plugins/<slug>/,
	// cross-plugin and http(s):// URLs are rejected, and the entry
	// has to end in .js. Each becomes a <script src=...> tag on the
	// viewer page, so the code runs in the chrome's window context.
	// Requires the ui.modify and http.serve permissions.
	Scripts []string `json:"scripts,omitempty"`
}

// BotConfig is the chat-bot configuration for plugins that post to
// chat. Optional; falls back to Manifest.DisplayName when unset (see
// ChatDisplayName).
type BotConfig struct {
	// DisplayName is what viewers see when the plugin posts to chat.
	// Empty means "use Manifest.DisplayName".
	DisplayName string `json:"displayName,omitempty"`
}

// ChatDisplayName resolves the name a plugin's chatbot user should
// post under. Bot.DisplayName wins when set, otherwise the plugin's
// own DisplayName. Never empty post-Validate because DisplayName is
// required.
func (m *Manifest) ChatDisplayName() string {
	if m.Bot.DisplayName != "" {
		return m.Bot.DisplayName
	}
	return m.DisplayName
}

// NetworkConfig narrows what hosts a plugin with the `network.fetch`
// permission can reach. The host passes AllowedHosts straight through to
// extism's manifest AllowedHosts; each entry is a hostname glob (e.g.
// "api.discord.com", "*.weather.com", "*").
//
// Plugins that declare `network.fetch` MUST declare a non-empty
// AllowedHosts list, the wildcard "*" is allowed but has to be written
// out so admins reviewing the manifest see the scope they're granting.
type NetworkConfig struct {
	AllowedHosts []string `json:"allowedHosts,omitempty"`
}

// ActionButton declares an entry the Owncast UI surfaces as an external
// action, a clickable button that loads a URL (in a modal or new tab) or
// shows raw HTML when pressed. Buttons declared here are merged with the
// admin-configured external actions while the plugin is enabled; when the
// plugin is disabled they disappear.
//
// Shape matches Owncast's existing ExternalAction. Exactly one of Url or
// Html must be set.
//
// Url ergonomics: if Url starts with "/" but not "/plugins/", it's treated
// as a relative path inside this plugin's namespace and the host rewrites
// it to "/plugins/<name><url>" at validation time. Absolute http(s) URLs
// and explicit "/plugins/<name>/..." paths are accepted as-is.
type ActionButton struct {
	Title          string `json:"title"`
	Url            string `json:"url,omitempty"`
	Html           string `json:"html,omitempty"`
	Icon           string `json:"icon,omitempty"`
	Color          string `json:"color,omitempty"`
	Description    string `json:"description,omitempty"`
	OpenExternally bool   `json:"openExternally,omitempty"`
}

// AdminConfig declares admin-only surfaces a plugin exposes. The Owncast
// admin web UI lists these in the "Plugins" section; each page renders the
// plugin's content at /plugins/<name>/<path>. Paths declared here are
// auth-gated by the host, unauthenticated requests get 401 before
// reaching the plugin.
type AdminConfig struct {
	Pages []AdminPage `json:"pages,omitempty"`
}

type AdminPage struct {
	Title string `json:"title"`
	// Path is a glob (e.g. "/admin", "/admin/*"). Requests under
	// /plugins/<name>/<rest> are checked against each glob and require
	// admin authentication when any match.
	Path string `json:"path"`
	Icon string `json:"icon,omitempty"`
}

func ParseManifest(b []byte) (*Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("parse manifest json: %w", err)
	}
	if err := m.Validate(); err != nil {
		return nil, err
	}
	return &m, nil
}

func (m *Manifest) Validate() error {
	if m.API != SupportedAPIVersion {
		return fmt.Errorf("unsupported api version %q (host supports %q)", m.API, SupportedAPIVersion)
	}
	if m.DisplayName == "" {
		return errors.New("manifest.name is required")
	}
	if m.Version == "" {
		return errors.New("manifest.version is required")
	}
	if m.Slug == "" {
		derived, err := slugify(m.DisplayName)
		if err != nil {
			return fmt.Errorf("could not auto-generate a slug from manifest.name %q: %w; set manifest.slug explicitly", m.DisplayName, err)
		}
		m.Slug = derived
	}
	if !slugPattern.MatchString(m.Slug) {
		return fmt.Errorf("manifest.slug %q is invalid; must match %s", m.Slug, slugPattern.String())
	}
	hasHttpServe := false
	hasNetworkFetch := false
	hasUIModify := false
	for _, p := range m.Permissions {
		if p == PermHttpServe {
			hasHttpServe = true
		}
		if p == PermNetworkFetch {
			hasNetworkFetch = true
		}
		if p == PermUIModify {
			hasUIModify = true
		}
	}
	// Action buttons are the only UI surface a plugin can place inside
	// Owncast's own chrome (the viewer action bar). Self-contained admin
	// pages and static content served under /plugins/<name>/ are baseline
	// plugin functionality and don't gate on this.
	if len(m.Actions) > 0 && !hasUIModify {
		return errors.New(
			"manifest.actions is set but the manifest does not declare " +
				"the \"ui.modify\" permission. Plugins that contribute viewer " +
				"action buttons must opt in to ui.modify so it's visible to " +
				"anyone reviewing the manifest that the plugin places UI " +
				"inside Owncast's chrome")
	}
	for i, page := range m.Admin.Pages {
		if page.Title == "" {
			return fmt.Errorf("manifest.admin.pages[%d].title is required", i)
		}
		if page.Path == "" {
			return fmt.Errorf("manifest.admin.pages[%d].path is required", i)
		}
	}
	if hasNetworkFetch && len(m.Network.AllowedHosts) == 0 {
		return errors.New(
			"manifest declares network.fetch but no network.allowedHosts; " +
				"list the hostnames you'll reach (globs OK, e.g. \"api.discord.com\", " +
				"\"*.weather.com\") or [\"*\"] for any host")
	}
	for i, host := range m.Network.AllowedHosts {
		if strings.TrimSpace(host) == "" {
			return fmt.Errorf("manifest.network.allowedHosts[%d] is empty", i)
		}
	}
	pluginPrefix := "/plugins/" + m.Slug + "/"
	for i := range m.Actions {
		a := &m.Actions[i]
		if a.Title == "" {
			return fmt.Errorf("manifest.actions[%d].title is required", i)
		}
		hasURL, hasHTML := a.Url != "", a.Html != ""
		if hasURL == hasHTML {
			return fmt.Errorf("manifest.actions[%d]: exactly one of url or html is required", i)
		}
		if hasURL {
			// Relative path inside the plugin's own namespace? Rewrite.
			if strings.HasPrefix(a.Url, "/") && !strings.HasPrefix(a.Url, "/plugins/") {
				a.Url = pluginPrefix + strings.TrimPrefix(a.Url, "/")
			}
			// http.serve required when the action points back into the plugin.
			if strings.HasPrefix(a.Url, pluginPrefix) && !hasHttpServe {
				return fmt.Errorf("manifest.actions[%d].url targets this plugin (%s) but http.serve permission is not declared",
					i, a.Url)
			}
			// Paths in other plugins' namespaces aren't allowed, catches typos
			// and prevents one plugin from advertising another's UI.
			if strings.HasPrefix(a.Url, "/plugins/") && !strings.HasPrefix(a.Url, pluginPrefix) {
				return fmt.Errorf("manifest.actions[%d].url points at another plugin's namespace: %s", i, a.Url)
			}
		}
		rewritten, err := rewriteActionIcon(pluginPrefix, hasHttpServe, a.Icon)
		if err != nil {
			return fmt.Errorf("manifest.actions[%d].icon: %w", i, err)
		}
		a.Icon = rewritten
	}
	// manifest.styles: CSS files the plugin contributes to the viewer
	// page. Same path-handling rules as actions (relative paths
	// auto-prefix to /plugins/<slug>/, cross-plugin paths rejected),
	// stricter on external URLs (rejected outright so admins see
	// every URL that will land in their viewer's global CSS scope).
	// Requires ui.modify (this restyles Owncast's chrome) and
	// http.serve (the host serves the bytes from the plugin's
	// namespace).
	if len(m.Styles) > 0 {
		if !hasUIModify {
			return errors.New(
				"manifest.styles is set but the manifest does not declare " +
					"the \"ui.modify\" permission; plugins that inject CSS " +
					"into the viewer's global scope must opt in to ui.modify " +
					"so it's visible to anyone reviewing the manifest that " +
					"the plugin restyles Owncast's UI")
		}
		if !hasHttpServe {
			return errors.New(
				"manifest.styles requires the \"http.serve\" permission so " +
					"the host can serve the bundled CSS files at " +
					"/plugins/<slug>/ URLs")
		}
		for i, raw := range m.Styles {
			if strings.TrimSpace(raw) == "" {
				return fmt.Errorf("manifest.styles[%d] is empty", i)
			}
			if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
				return fmt.Errorf("manifest.styles[%d] cannot be an absolute URL (%q); bundle CSS files under assets/ and reference them by path", i, raw)
			}
			path := raw
			switch {
			case strings.HasPrefix(path, "/plugins/"):
				// Already-absolute plugin path; checked below.
			case strings.HasPrefix(path, "/"):
				path = pluginPrefix + strings.TrimPrefix(path, "/")
			default:
				path = pluginPrefix + path
			}
			if !strings.HasPrefix(path, pluginPrefix) {
				return fmt.Errorf("manifest.styles[%d] points at another plugin's namespace: %s", i, path)
			}
			if !strings.HasSuffix(strings.ToLower(path), ".css") {
				return fmt.Errorf("manifest.styles[%d] must end in .css (got %q)", i, raw)
			}
			m.Styles[i] = path
		}
	}
	// manifest.scripts: JS files the plugin contributes to the
	// viewer page. Same rules as styles, applied to .js entries.
	if len(m.Scripts) > 0 {
		if !hasUIModify {
			return errors.New(
				"manifest.scripts is set but the manifest does not declare " +
					"the \"ui.modify\" permission; plugins that inject " +
					"JavaScript into the viewer page must opt in to " +
					"ui.modify so it's visible to anyone reviewing the " +
					"manifest that the plugin runs code inside Owncast's chrome")
		}
		if !hasHttpServe {
			return errors.New(
				"manifest.scripts requires the \"http.serve\" permission " +
					"so the host can serve the bundled JavaScript files at " +
					"/plugins/<slug>/ URLs")
		}
		for i, raw := range m.Scripts {
			if strings.TrimSpace(raw) == "" {
				return fmt.Errorf("manifest.scripts[%d] is empty", i)
			}
			if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
				return fmt.Errorf("manifest.scripts[%d] cannot be an absolute URL (%q); bundle JavaScript files under assets/ and reference them by path", i, raw)
			}
			path := raw
			switch {
			case strings.HasPrefix(path, "/plugins/"):
				// Already-absolute plugin path; checked below.
			case strings.HasPrefix(path, "/"):
				path = pluginPrefix + strings.TrimPrefix(path, "/")
			default:
				path = pluginPrefix + path
			}
			if !strings.HasPrefix(path, pluginPrefix) {
				return fmt.Errorf("manifest.scripts[%d] points at another plugin's namespace: %s", i, path)
			}
			if !strings.HasSuffix(strings.ToLower(path), ".js") {
				return fmt.Errorf("manifest.scripts[%d] must end in .js (got %q)", i, raw)
			}
			m.Scripts[i] = path
		}
	}
	return nil
}

// rewriteActionIcon applies the same path-handling rules to a button's
// icon URL as we do to the button's url: a same-origin relative path is
// rewritten into this plugin's namespace; an http(s) URL is left alone;
// a cross-plugin path is rejected. Empty input passes through, icons
// are optional.
func rewriteActionIcon(pluginPrefix string, hasHttpServe bool, icon string) (string, error) {
	if icon == "" {
		return "", nil
	}
	if strings.HasPrefix(icon, "http://") || strings.HasPrefix(icon, "https://") {
		return icon, nil
	}
	if strings.HasPrefix(icon, "/") && !strings.HasPrefix(icon, "/plugins/") {
		icon = pluginPrefix + strings.TrimPrefix(icon, "/")
	}
	if strings.HasPrefix(icon, pluginPrefix) && !hasHttpServe {
		return "", fmt.Errorf("targets this plugin (%s) but http.serve permission is not declared", icon)
	}
	if strings.HasPrefix(icon, "/plugins/") && !strings.HasPrefix(icon, pluginPrefix) {
		return "", fmt.Errorf("points at another plugin's namespace: %s", icon)
	}
	return icon, nil
}

// AgreesWith reports whether the runtime registration `other` is consistent
// with the sidecar manifest. The sidecar declares identity and permissions;
// the runtime must not exceed declared permissions. Subscriptions are derived
// by the SDK at runtime, so they aren't validated here.
//
// Identity comparison runs on Slug (the canonical identifier), not
// DisplayName. When either side ships no explicit Slug field, the helper
// derives one from DisplayName the same way ParseManifest does, so the
// comparison still works with a register() output that only echoes back
// the display name.
func (m *Manifest) AgreesWith(other *Manifest) error {
	resolveSlug := func(x *Manifest) string {
		if x.Slug != "" {
			return x.Slug
		}
		if x.DisplayName == "" {
			return ""
		}
		derived, err := slugify(x.DisplayName)
		if err != nil {
			return ""
		}
		return derived
	}
	mySlug := resolveSlug(m)
	otherSlug := resolveSlug(other)
	if mySlug != otherSlug {
		return fmt.Errorf("slug mismatch: manifest=%q register=%q", mySlug, otherSlug)
	}
	if m.Version != other.Version {
		return fmt.Errorf("version mismatch: manifest=%q register=%q", m.Version, other.Version)
	}
	declared := stringSet(m.Permissions)
	for _, p := range other.Permissions {
		if !declared[p] {
			return fmt.Errorf("plugin requested permission %q at runtime not declared in manifest", p)
		}
	}
	return nil
}

// slugify turns a free-form display name into a URL-safe slug
// matching slugPattern. ASCII letters and digits pass through
// lowercased; every other rune collapses to a single hyphen; leading
// and trailing hyphens are trimmed. Non-ASCII input degrades noisily
// (e.g. "Café Helper" becomes "caf-helper") so plugins with
// diacritics or non-Latin names should pin slug explicitly in their
// manifest. Returns an error when the result is empty or fails the
// "starts with a letter" rule.
func slugify(input string) (string, error) {
	var sb strings.Builder
	prevHyphen := false
	for _, r := range input {
		switch {
		case r >= 'a' && r <= 'z':
			sb.WriteRune(r)
			prevHyphen = false
		case r >= 'A' && r <= 'Z':
			sb.WriteRune(r + ('a' - 'A'))
			prevHyphen = false
		case r >= '0' && r <= '9':
			sb.WriteRune(r)
			prevHyphen = false
		default:
			if !prevHyphen && sb.Len() > 0 {
				sb.WriteRune('-')
				prevHyphen = true
			}
		}
	}
	out := strings.TrimRight(sb.String(), "-")
	if out == "" {
		return "", errors.New("slugified value is empty")
	}
	if !slugPattern.MatchString(out) {
		return "", fmt.Errorf("slugified value %q does not match the required pattern", out)
	}
	return out, nil
}

func stringSet(items []string) map[string]bool {
	out := make(map[string]bool, len(items))
	for _, i := range items {
		out[i] = true
	}
	return out
}
