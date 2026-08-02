package testing

import (
	"encoding/json"
	"fmt"
	"os"

	plugin "github.com/owncast/owncast/services/plugins"
)

// Scenario is one named test case loaded from a *.test.json file. A file
// contains a JSON array of scenarios.
type Scenario struct {
	Name   string         `json:"name"`
	Given  ScenarioGiven  `json:"given,omitempty"`
	Steps  []ScenarioStep `json:"events"`
	Expect ScenarioExpect `json:"expect,omitempty"`
}

type ScenarioGiven struct {
	// KV pre-populates the plugin's namespaced key/value store before steps
	// run. Keys are plain strings; values are stored as their JSON-encoded
	// string form (most plugins read them via parseInt/etc., so storing the
	// stringified value is the most useful default).
	KV map[string]string `json:"kv,omitempty"`
	// Config seeds admin-set overrides for manifest-declared config keys:
	// owncast.config.get returns the override instead of the manifest
	// default. Keys must still be declared in the manifest; undeclared keys
	// stay invisible to the plugin regardless of this map.
	Config map[string]any `json:"config,omitempty"`
	// HTTPResponses installs canned responses for plugin HTTP requests.
	// First matching fixture (URL glob + optional method) wins. Tests fail
	// if a plugin makes a request that no fixture matches.
	HTTPResponses []ScenarioHTTPFixture `json:"httpResponses,omitempty"`
	// Stream is what owncast.stream.current() returns to the plugin during
	// this scenario. Unset → zero values (online=false, viewers=0, etc.).
	Stream *plugin.StreamInfo `json:"stream,omitempty"`
	// Server is what owncast.server.info() returns to the plugin.
	Server *plugin.ServerInfo `json:"server,omitempty"`
	// ChatHistory pre-seeds owncast.chat.history() output.
	ChatHistory []plugin.HostChatMessage `json:"chatHistory,omitempty"`
	// ChatClients pre-seeds owncast.chat.clients() output.
	ChatClients []plugin.HostChatClient `json:"chatClients,omitempty"`
	// Users pre-seeds owncast.users.list() / .get() output.
	Users []plugin.HostUser `json:"users,omitempty"`
	// Socials pre-seeds owncast.server.socials().
	Socials []plugin.SocialHandle `json:"socials,omitempty"`
	// Federation pre-seeds owncast.server.federation().
	Federation *plugin.FederationInfo `json:"federation,omitempty"`
	// Broadcaster pre-seeds owncast.stream.broadcaster().
	Broadcaster *plugin.StreamBroadcaster `json:"broadcaster,omitempty"`
	// Tags pre-seeds owncast.server.tags().
	Tags []string `json:"tags,omitempty"`
	// VideoConfig pre-seeds owncast.videoConfig.read().
	VideoConfig *plugin.VideoConfig `json:"videoConfig,omitempty"`
}

type ScenarioHTTPFixture struct {
	URL     string            `json:"url"`              // glob, e.g. "https://api.foo.com/*"
	Method  string            `json:"method,omitempty"` // empty matches any method
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`
}

type ScenarioStep struct {
	// Exactly one of Event, Filter, HTTP, TabContent, PageContent, PageStyles,
	// or PageScripts must be set.
	// - Event:       notification dispatch
	// - Filter:      filter chain, Expect asserts on the FilterResult
	// - HTTP:        sends an HTTP request through plugin.Server, HTTPExpect
	//                asserts on the response
	// - TabContent:  invokes the plugin's on_tab_content export
	// - PageContent: invokes the plugin's on_page_content export
	// - PageStyles:  invokes the plugin's on_page_styles export (CSS); slug and
	//                user are ignored — the hook is global
	// - PageScripts: invokes the plugin's on_page_scripts export (JavaScript)
	Event       string         `json:"event,omitempty"`
	Filter      string         `json:"filter,omitempty"`
	Payload     any            `json:"payload,omitempty"`
	HTTP        *HTTPStep      `json:"http,omitempty"`
	TabContent  *ContentStep   `json:"tabContent,omitempty"`
	PageContent *ContentStep   `json:"pageContent,omitempty"`
	PageStyles  *ContentStep   `json:"pageStyles,omitempty"`
	PageScripts *ContentStep   `json:"pageScripts,omitempty"`
	AuthCheck   *AuthCheckStep `json:"authCheck,omitempty"`
	Expect      *FilterExpect  `json:"expect,omitempty"`
}

// AuthCheckStep invokes the plugin's on_auth_check export with a resolved user
// identity and asserts the verdict (auth.gate session re-validation).
type AuthCheckStep struct {
	User   *plugin.HostUser `json:"user,omitempty"`
	Expect *AuthCheckExpect `json:"expect,omitempty"`
}

// AuthCheckExpect asserts on an onAuthCheck verdict. Action is always checked;
// Reason only when set.
type AuthCheckExpect struct {
	Action string `json:"action"`
	Reason string `json:"reason,omitempty"`
}

// HTTPStep is an inbound request sent at the plugin via plugin.Server.
type HTTPStep struct {
	Method  string            `json:"method,omitempty"`
	Path    string            `json:"path"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`
	// Authenticated marks the request as coming from an authenticated
	// Owncast admin. Sets the test-only X-Test-Admin header that the mock
	// host's IsAuthenticated callback honors.
	Authenticated bool `json:"authenticated,omitempty"`
	// User marks the request as coming with a user-token; the user's
	// identity is forwarded to the plugin as req.user. Setting user also
	// implies authenticated=true.
	User   *plugin.HostUser `json:"user,omitempty"`
	Expect *HTTPExpect      `json:"expect,omitempty"`
}

// HTTPExpect asserts on the response from an HTTPStep.
type HTTPExpect struct {
	Status       int               `json:"status,omitempty"`
	Headers      map[string]string `json:"headers,omitempty"`
	Body         string            `json:"body,omitempty"`
	BodyContains string            `json:"bodyContains,omitempty"`
}

// ContentStep invokes the plugin's on_tab_content or on_page_content export.
type ContentStep struct {
	Slug   string           `json:"slug"`
	User   *plugin.HostUser `json:"user,omitempty"`
	Expect *ContentExpect   `json:"expect,omitempty"`
}

// ContentExpect asserts on the HTML returned by a ContentStep.
type ContentExpect struct {
	Body         string `json:"body,omitempty"`
	BodyContains string `json:"bodyContains,omitempty"`
}

func (s *ScenarioStep) Validate() error {
	count := 0
	if s.Event != "" {
		count++
	}
	if s.Filter != "" {
		count++
	}
	if s.HTTP != nil {
		count++
	}
	if s.TabContent != nil {
		count++
	}
	if s.PageContent != nil {
		count++
	}
	if s.PageStyles != nil {
		count++
	}
	if s.PageScripts != nil {
		count++
	}
	if s.AuthCheck != nil {
		count++
	}
	if count != 1 {
		return fmt.Errorf("step must set exactly one of `event`, `filter`, `http`, `tabContent`, `pageContent`, `pageStyles`, `pageScripts`, or `authCheck`")
	}
	if s.Filter == "" && s.Expect != nil {
		return fmt.Errorf("step.expect is only valid on filter steps (use http.expect for http steps)")
	}
	if s.HTTP != nil && s.HTTP.Path == "" {
		return fmt.Errorf("http step requires path")
	}
	return nil
}

// FilterExpect asserts on a FilterResult returned by a filter step.
type FilterExpect struct {
	Action  string `json:"action"`
	Payload any    `json:"payload,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

// ScenarioExpect asserts on side effects accumulated across all steps.
type ScenarioExpect struct {
	ChatSends         []string                         `json:"chatSends,omitempty"`
	ChatActions       []string                         `json:"chatActions,omitempty"`
	ChatSystems       []string                         `json:"chatSystems,omitempty"`
	Logs              []ScenarioLogExpect              `json:"logs,omitempty"`
	DeletedMessages   []string                         `json:"deletedMessages,omitempty"`
	KickedClients     []uint64                         `json:"kickedClients,omitempty"`
	DiscordPosts      []string                         `json:"discordPosts,omitempty"`
	BrowserPushes     []ScenarioBrowserPushExpect      `json:"browserPushes,omitempty"`
	UserModerations   []ScenarioUserModerationExpect   `json:"userModerations,omitempty"`
	BannedIPs         []string                         `json:"bannedIPs,omitempty"`
	UserRegistrations []ScenarioUserRegistrationExpect `json:"userRegistrations,omitempty"`
	SessionGrants     []ScenarioSessionGrantExpect     `json:"sessionGrants,omitempty"`
	SessionClears     int                              `json:"sessionClears,omitempty"`
	Uploads           []ScenarioUploadExpect           `json:"uploads,omitempty"`
	FediversePosts    []ScenarioFediverseExpect        `json:"fediversePosts,omitempty"`
	FediverseOutbox   []string                         `json:"fediverseOutbox,omitempty"`
	ChatTo            []ScenarioChatToExpect           `json:"chatTo,omitempty"`
	VideoConfigWrites []plugin.VideoConfigUpdate       `json:"videoConfigWrites,omitempty"`
	Emits             []EmitExpect                     `json:"emits,omitempty"`
	KV                map[string]string                `json:"kv,omitempty"`
	HTTPRequests      []ScenarioHTTPRequestExpect      `json:"httpRequests,omitempty"`
	SSESends          []ScenarioSSEExpect              `json:"sseSends,omitempty"`
	Commands          []ScenarioCommandExpect          `json:"commands,omitempty"`
}

type ScenarioLogExpect struct {
	Plugin  string `json:"plugin"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

// ScenarioCommandExpect asserts on one core-routed command registration.
// Entries are matched by Name in any order. Prefix, Description, Usage, and
// Aliases are checked only when set. ModOnly, CaseSensitive, and CooldownMs are
// always checked.
type ScenarioCommandExpect struct {
	Name          string   `json:"name"`
	Prefix        string   `json:"prefix,omitempty"`
	Description   string   `json:"description,omitempty"`
	Usage         string   `json:"usage,omitempty"`
	Aliases       []string `json:"aliases,omitempty"`
	ModOnly       bool     `json:"modOnly,omitempty"`
	CaseSensitive bool     `json:"caseSensitive,omitempty"`
	CooldownMs    int64    `json:"cooldownMs,omitempty"`
}

type ScenarioBrowserPushExpect struct {
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
	URL   string `json:"url,omitempty"`
}

type ScenarioUserModerationExpect struct {
	UserID  string `json:"userId"`
	Enabled bool   `json:"enabled"`
	Reason  string `json:"reason,omitempty"`
}

// ScenarioUserRegistrationExpect asserts on one owncast.users.register call.
// AuthID is always checked. Optional fields are checked when present, including
// empty strings, empty scopes, and false.
type ScenarioUserRegistrationExpect struct {
	AuthID      string   `json:"authId"`
	DisplayName *string  `json:"displayName,omitempty"`
	Scopes      []string `json:"scopes,omitempty"`
	ProfileURL  *string  `json:"profileUrl,omitempty"`
	Handle      *string  `json:"handle,omitempty"`
	Public      *bool    `json:"public,omitempty"`
}

// ScenarioSessionGrantExpect asserts on one owncast.auth.grantSession call.
// TTL is checked only when non-zero; UserID is always checked.
type ScenarioSessionGrantExpect struct {
	UserID string `json:"userId"`
	TTL    int64  `json:"ttl,omitempty"`
}

// ScenarioUploadExpect asserts on one owncast.storage.upload call. Body is
// checked when non-empty. BodyBase64 is checked when present, including "".
type ScenarioUploadExpect struct {
	Name       string  `json:"name"`
	Body       string  `json:"body,omitempty"`
	BodyBase64 *string `json:"bodyBase64,omitempty"`
}

type ScenarioFediverseExpect struct {
	Type  string `json:"type"`
	Body  string `json:"body,omitempty"`
	Image string `json:"image,omitempty"`
	Link  string `json:"link,omitempty"`
}

type ScenarioChatToExpect struct {
	ClientID uint64 `json:"clientId"`
	Text     string `json:"text"`
}

// ScenarioSSEExpect asserts on one owncast.sse.send call (in order). An empty
// Event or Data field skips that part of the match.
type ScenarioSSEExpect struct {
	Channel string `json:"channel"`
	Event   string `json:"event,omitempty"`
	Data    string `json:"data,omitempty"`
}

type ScenarioHTTPRequestExpect struct {
	URL    string `json:"url"`              // exact URL match
	Method string `json:"method,omitempty"` // empty matches any method
	Body   string `json:"body,omitempty"`   // empty skips body check
}

type EmitExpect struct {
	EventType string `json:"eventType"`
	Payload   any    `json:"payload,omitempty"`
}

// LoadScenarios reads and parses a single *.test.json file. The top level
// must be a JSON array.
func LoadScenarios(path string) ([]Scenario, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var scenarios []Scenario
	if err := json.Unmarshal(data, &scenarios); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	for i := range scenarios {
		if scenarios[i].Name == "" {
			return nil, fmt.Errorf("%s: scenario %d has no name", path, i)
		}
		for j := range scenarios[i].Steps {
			if err := scenarios[i].Steps[j].Validate(); err != nil {
				return nil, fmt.Errorf("%s: scenario %q step %d: %w", path, scenarios[i].Name, j, err)
			}
		}
	}
	return scenarios, nil
}
