package testing

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/owncast/owncast-plugin-sdk/host-runtime/plugin"
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
	// Exactly one of Event, Filter, or HTTP must be set.
	// - Event:  notification dispatch
	// - Filter: filter chain, Expect asserts on the FilterResult
	// - HTTP:   sends an HTTP request through plugin.Server, HTTPExpect
	//           asserts on the response
	Event   string        `json:"event,omitempty"`
	Filter  string        `json:"filter,omitempty"`
	Payload any           `json:"payload,omitempty"`
	HTTP    *HTTPStep     `json:"http,omitempty"`
	Expect  *FilterExpect `json:"expect,omitempty"`
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
	Status  int               `json:"status,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`
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
	if count != 1 {
		return fmt.Errorf("step must set exactly one of `event`, `filter`, or `http`")
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
	ChatSends         []string                       `json:"chatSends,omitempty"`
	ChatActions       []string                       `json:"chatActions,omitempty"`
	ChatSystems       []string                       `json:"chatSystems,omitempty"`
	DeletedMessages   []string                       `json:"deletedMessages,omitempty"`
	KickedClients     []uint64                       `json:"kickedClients,omitempty"`
	DiscordPosts      []string                       `json:"discordPosts,omitempty"`
	BrowserPushes     []ScenarioBrowserPushExpect    `json:"browserPushes,omitempty"`
	UserModerations   []ScenarioUserModerationExpect `json:"userModerations,omitempty"`
	BannedIPs         []string                       `json:"bannedIPs,omitempty"`
	Uploads           []ScenarioUploadExpect         `json:"uploads,omitempty"`
	FediversePosts    []ScenarioFediverseExpect      `json:"fediversePosts,omitempty"`
	FediverseOutbox   []string                       `json:"fediverseOutbox,omitempty"`
	ChatTo            []ScenarioChatToExpect         `json:"chatTo,omitempty"`
	VideoConfigWrites []plugin.VideoConfigUpdate     `json:"videoConfigWrites,omitempty"`
	Emits             []EmitExpect                   `json:"emits,omitempty"`
	KV                map[string]string              `json:"kv,omitempty"`
	HTTPRequests      []ScenarioHTTPRequestExpect    `json:"httpRequests,omitempty"`
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

type ScenarioUploadExpect struct {
	Name string `json:"name"`
	Body string `json:"body,omitempty"` // string form of bytes; for binary use base64, future
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
