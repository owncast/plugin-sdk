package testing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/gobwas/glob"
	"github.com/owncast/owncast-plugin-sdk/host-runtime/kv"
	"github.com/owncast/owncast-plugin-sdk/host-runtime/plugin"
)

// EmittedEvent records a single owncast.events.emit() call.
type EmittedEvent struct {
	EventType string
	Payload   any
}

// MockHost is a HostEnv implementation that records side effects in memory.
// Each scenario gets its own MockHost so state is isolated.
//
// emits are recorded but NOT dispatched, single-plugin tests don't load
// the receiving plugin. Cross-plugin tests are a separate (future) mode.
// RecordedHTTPRequest is an HTTP request the plugin made during a scenario.
type RecordedHTTPRequest struct {
	URL    string
	Method string
	Body   string
}

// HTTPFixture is a canned response the mock returns when the plugin makes a
// matching HTTP request. URLPattern is a glob (e.g. "https://api.weather.com/*").
type HTTPFixture struct {
	URLPattern string
	Method     string // empty matches any method
	Status     int
	Headers    map[string]string
	Body       string
}

// RecordedBrowserPush records a single owncast.notifications.browserPush call.
type RecordedBrowserPush struct {
	Title string
	Body  string
	URL   string
}

// RecordedUserModeration captures an owncast.users.setEnabled call.
type RecordedUserModeration struct {
	UserID  string
	Enabled bool
	Reason  string
}

// RecordedUpload captures an owncast.storage.upload call. The mock returns
// a synthetic URL of the form "mock://<plugin>/<name>" unless configured.
type RecordedUpload struct {
	Name string
	Data []byte
	URL  string
}

// RecordedFediverse captures an owncast.notifications.fediverse call.
type RecordedFediverse struct {
	Type  string
	Body  string
	Image string
	Link  string
}

// RecordedChatTo captures an owncast.chat.sendTo call.
type RecordedChatTo struct {
	ClientID uint64
	Text     string
}

type MockHost struct {
	store             kv.Store
	mu                sync.Mutex
	chatSends         []string
	chatActions       []string
	chatSystems       []string
	emits             []EmittedEvent
	httpFixtures      []HTTPFixture
	httpRecords       []RecordedHTTPRequest
	deletedMessages   []string
	kickedClients     []uint64
	discordPosts      []string
	browserPushes     []RecordedBrowserPush
	userMods          []RecordedUserModeration
	bannedIPs         []string
	uploads           []RecordedUpload
	fediversePosts    []RecordedFediverse
	fediverseOutbox   []string
	chatTo            []RecordedChatTo
	socials           []plugin.SocialHandle
	federation        plugin.FederationInfo
	videoConfigWrites []plugin.VideoConfigUpdate

	// Test-supplied stream / server / chat-history state. If unset, the
	// host functions return zero values (plugins see "offline" / empty
	// server info / no history).
	streamCurrent plugin.StreamInfo
	serverInfo    plugin.ServerInfo
	broadcaster   plugin.StreamBroadcaster
	videoConfig   plugin.VideoConfig
	tags          []string
	chatHistory   []plugin.HostChatMessage
	chatClients   []plugin.HostChatClient
	users         []plugin.HostUser
	uploadURLBase string // returned URLs become uploadURLBase + name (default "mock://<name>/")
}

func NewMockHost() *MockHost {
	return &MockHost{store: kv.NewMemory()}
}

// IsAuthenticated is the auth predicate the test runner installs on
// plugin.Server. A scenario marks a request as admin-authenticated via
// http.authenticated=true, which sets X-Test-Admin: 1 on the request. A
// scenario marks a request as user-authenticated via http.user={...},
// which sets X-Test-User: <json>, either form counts as authenticated.
func (m *MockHost) IsAuthenticated(r *http.Request) bool {
	if r.Header.Get("X-Test-Admin") == "1" {
		return true
	}
	return r.Header.Get("X-Test-User") != ""
}

// GetRequestUser parses the X-Test-User header (set by scenarios that mark
// a request with http.user={...}) into a HostUser.
func (m *MockHost) GetRequestUser(r *http.Request) *plugin.HostUser {
	raw := r.Header.Get("X-Test-User")
	if raw == "" {
		return nil
	}
	var u plugin.HostUser
	if err := json.Unmarshal([]byte(raw), &u); err != nil {
		return nil
	}
	return &u
}

// HostEnv returns a *plugin.HostEnv wired to record this MockHost's state.
// The returned HostEnv is what gets passed to plugin.LoadPlugin.
func (m *MockHost) HostEnv() *plugin.HostEnv {
	return &plugin.HostEnv{
		KV: m.store,
		OnChat: func(req plugin.ChatSendRequest) {
			m.mu.Lock()
			defer m.mu.Unlock()
			switch req.Kind {
			case plugin.ChatSendAction:
				m.chatActions = append(m.chatActions, req.Text)
			case plugin.ChatSendSystem:
				m.chatSystems = append(m.chatSystems, req.Text)
			default:
				m.chatSends = append(m.chatSends, req.Text)
			}
		},
		Emit: func(_ context.Context, eventType string, payload any) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.emits = append(m.emits, EmittedEvent{EventType: eventType, Payload: payload})
		},
		StreamCurrent: func() plugin.StreamInfo {
			m.mu.Lock()
			defer m.mu.Unlock()
			return m.streamCurrent
		},
		ServerInfo: func() plugin.ServerInfo {
			m.mu.Lock()
			defer m.mu.Unlock()
			return m.serverInfo
		},
		Broadcaster: func() plugin.StreamBroadcaster {
			m.mu.Lock()
			defer m.mu.Unlock()
			return m.broadcaster
		},
		VideoConfig: func() plugin.VideoConfig {
			m.mu.Lock()
			defer m.mu.Unlock()
			return m.videoConfig
		},
		Tags: func() []string {
			m.mu.Lock()
			defer m.mu.Unlock()
			return append([]string(nil), m.tags...)
		},
		ChatHistory: func(limit int) []plugin.HostChatMessage {
			m.mu.Lock()
			defer m.mu.Unlock()
			out := append([]plugin.HostChatMessage(nil), m.chatHistory...)
			if limit > 0 && limit < len(out) {
				out = out[len(out)-limit:]
			}
			return out
		},
		DeleteMessage: func(_, id string) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.deletedMessages = append(m.deletedMessages, id)
		},
		KickClient: func(_ string, id uint64) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.kickedClients = append(m.kickedClients, id)
		},
		SendDiscord: func(_, text string) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.discordPosts = append(m.discordPosts, text)
		},
		SendBrowserPush: func(_ string, p plugin.BrowserPushPayload) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.browserPushes = append(m.browserPushes, RecordedBrowserPush{
				Title: p.Title, Body: p.Body, URL: p.URL,
			})
		},
		ChatClients: func() []plugin.HostChatClient {
			m.mu.Lock()
			defer m.mu.Unlock()
			return append([]plugin.HostChatClient(nil), m.chatClients...)
		},
		Users: func() []plugin.HostUser {
			m.mu.Lock()
			defer m.mu.Unlock()
			return append([]plugin.HostUser(nil), m.users...)
		},
		UserGet: func(id string) (plugin.HostUser, bool) {
			m.mu.Lock()
			defer m.mu.Unlock()
			for _, u := range m.users {
				if u.ID == id {
					return u, true
				}
			}
			return plugin.HostUser{}, false
		},
		SetUserEnabled: func(_, id string, enabled bool, reason string) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.userMods = append(m.userMods, RecordedUserModeration{
				UserID: id, Enabled: enabled, Reason: reason,
			})
		},
		BanIP: func(_, ip string) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.bannedIPs = append(m.bannedIPs, ip)
		},
		Socials: func() []plugin.SocialHandle {
			m.mu.Lock()
			defer m.mu.Unlock()
			return append([]plugin.SocialHandle(nil), m.socials...)
		},
		Federation: func() plugin.FederationInfo {
			m.mu.Lock()
			defer m.mu.Unlock()
			return m.federation
		},
		WriteVideoConfig: func(_ string, u plugin.VideoConfigUpdate) error {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.videoConfigWrites = append(m.videoConfigWrites, u)
			return nil
		},
		SendFediverse: func(_ string, p plugin.FediversePayload) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.fediversePosts = append(m.fediversePosts, RecordedFediverse{
				Type: p.Type, Body: p.Body, Image: p.Image, Link: p.Link,
			})
		},
		SendChatTo: func(_ string, clientID uint64, text string) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.chatTo = append(m.chatTo, RecordedChatTo{ClientID: clientID, Text: text})
		},
		PostFediverse: func(pluginName, text string) (string, error) {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.fediverseOutbox = append(m.fediverseOutbox, text)
			return fmt.Sprintf("mock://fediverse/%s/%d", pluginName, len(m.fediverseOutbox)), nil
		},
		UploadStorage: func(_, name string, data []byte) (string, error) {
			m.mu.Lock()
			defer m.mu.Unlock()
			base := m.uploadURLBase
			if base == "" {
				base = "mock://uploads/"
			}
			url := base + name
			cp := make([]byte, len(data))
			copy(cp, data)
			m.uploads = append(m.uploads, RecordedUpload{Name: name, Data: cp, URL: url})
			return url, nil
		},
	}
}

// SetChatClients / SetUsers / SetUploadURLBase install test-time state for
// the corresponding host functions.
func (m *MockHost) SetChatClients(c []plugin.HostChatClient) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.chatClients = append([]plugin.HostChatClient(nil), c...)
}

func (m *MockHost) SetUsers(u []plugin.HostUser) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.users = append([]plugin.HostUser(nil), u...)
}

func (m *MockHost) UserModerations() []RecordedUserModeration {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]RecordedUserModeration(nil), m.userMods...)
}

func (m *MockHost) BannedIPs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.bannedIPs...)
}

func (m *MockHost) Uploads() []RecordedUpload {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]RecordedUpload(nil), m.uploads...)
}

func (m *MockHost) FediversePosts() []RecordedFediverse {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]RecordedFediverse(nil), m.fediversePosts...)
}

func (m *MockHost) ChatTo() []RecordedChatTo {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]RecordedChatTo(nil), m.chatTo...)
}

func (m *MockHost) FediverseOutbox() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.fediverseOutbox...)
}

// VideoConfigWrites returns the partial video-config changes a plugin applied
// via owncast.videoConfig.write(), in call order.
func (m *MockHost) VideoConfigWrites() []plugin.VideoConfigUpdate {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]plugin.VideoConfigUpdate(nil), m.videoConfigWrites...)
}

func (m *MockHost) SetSocials(s []plugin.SocialHandle) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.socials = append([]plugin.SocialHandle(nil), s...)
}

func (m *MockHost) SetFederation(f plugin.FederationInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.federation = f
}

func (m *MockHost) DeletedMessages() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.deletedMessages...)
}

func (m *MockHost) KickedClients() []uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]uint64(nil), m.kickedClients...)
}

func (m *MockHost) DiscordPosts() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.discordPosts...)
}

func (m *MockHost) BrowserPushes() []RecordedBrowserPush {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]RecordedBrowserPush(nil), m.browserPushes...)
}

// SetStreamCurrent / SetServerInfo install canned responses for the
// owncast.stream.current() and owncast.server.info() host functions. Tests
// use these to drive plugins through different runtime states.
func (m *MockHost) SetStreamCurrent(info plugin.StreamInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.streamCurrent = info
}

func (m *MockHost) SetServerInfo(info plugin.ServerInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.serverInfo = info
}

func (m *MockHost) SetBroadcaster(b plugin.StreamBroadcaster) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.broadcaster = b
}

func (m *MockHost) SetVideoConfig(c plugin.VideoConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.videoConfig = c
}

func (m *MockHost) SetTags(t []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tags = append([]string(nil), t...)
}

func (m *MockHost) SetChatHistory(msgs []plugin.HostChatMessage) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.chatHistory = append([]plugin.HostChatMessage(nil), msgs...)
}

func (m *MockHost) ChatSends() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.chatSends...)
}

func (m *MockHost) ChatActions() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.chatActions...)
}

func (m *MockHost) ChatSystems() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.chatSystems...)
}

func (m *MockHost) Emits() []EmittedEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]EmittedEvent(nil), m.emits...)
}

// SeedKV pre-populates the named plugin's KV namespace from a string map.
// Used to apply scenario.given.kv before the steps run.
func (m *MockHost) SeedKV(pluginName string, kv map[string]string) error {
	ns := m.store.Namespace(pluginName)
	for k, v := range kv {
		if err := ns.Set(k, []byte(v)); err != nil {
			return err
		}
	}
	return nil
}

// SetHTTPFixtures installs the canned responses the mock will return.
// First match (URL glob + optional method) wins.
func (m *MockHost) SetHTTPFixtures(fs []HTTPFixture) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.httpFixtures = fs
}

func (m *MockHost) HTTPRequests() []RecordedHTTPRequest {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]RecordedHTTPRequest(nil), m.httpRecords...)
}

// HTTPTransport returns an http.RoundTripper that records requests and
// serves canned responses. Install it on http.DefaultClient.Transport for
// the duration of a scenario; Extism's built-in HTTP uses http.DefaultClient.
func (m *MockHost) HTTPTransport() http.RoundTripper {
	return &mockTransport{host: m}
}

type mockTransport struct {
	host *MockHost
}

func (t *mockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	var body string
	if req.Body != nil {
		b, _ := io.ReadAll(req.Body)
		body = string(b)
	}

	t.host.mu.Lock()
	t.host.httpRecords = append(t.host.httpRecords, RecordedHTTPRequest{
		URL: req.URL.String(), Method: req.Method, Body: body,
	})
	fixtures := append([]HTTPFixture(nil), t.host.httpFixtures...)
	t.host.mu.Unlock()

	for _, f := range fixtures {
		if f.Method != "" && !strings.EqualFold(f.Method, req.Method) {
			continue
		}
		matcher, err := glob.Compile(f.URLPattern)
		if err != nil {
			continue
		}
		if matcher.Match(req.URL.String()) {
			h := http.Header{}
			for k, v := range f.Headers {
				h.Set(k, v)
			}
			return &http.Response{
				Status:        fmt.Sprintf("%d %s", f.Status, http.StatusText(f.Status)),
				StatusCode:    f.Status,
				Proto:         "HTTP/1.1",
				ProtoMajor:    1,
				ProtoMinor:    1,
				Header:        h,
				Body:          io.NopCloser(strings.NewReader(f.Body)),
				ContentLength: int64(len(f.Body)),
				Request:       req,
			}, nil
		}
	}
	return nil, fmt.Errorf("no http fixture matched %s %s", req.Method, req.URL.String())
}

// SnapshotKV returns the current contents of the named plugin's namespace
// as string→string. Used for scenario.expect.kv assertions.
func (m *MockHost) SnapshotKV(pluginName string) map[string]string {
	ns := m.store.Namespace(pluginName)
	type snapshotter interface{ Snapshot() map[string][]byte }
	if s, ok := ns.(snapshotter); ok {
		raw := s.Snapshot()
		out := make(map[string]string, len(raw))
		for k, v := range raw {
			out[k] = string(v)
		}
		return out
	}
	return nil
}
