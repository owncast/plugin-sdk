package testing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"

	"github.com/owncast/owncast-plugin-sdk/host-runtime/plugin"
)

// Result is the outcome of running a single scenario.
type Result struct {
	File     string
	Scenario string
	Pass     bool
	Errors   []string
}

// RunFile loads scenarios from path and runs each against the given plugin
// (wasmPath + manifestPath). One Result per scenario.
func RunFile(ctx context.Context, wasmPath, manifestPath, path string) ([]Result, error) {
	scenarios, err := LoadScenarios(path)
	if err != nil {
		return nil, err
	}
	out := make([]Result, 0, len(scenarios))
	for _, sc := range scenarios {
		out = append(out, runOne(ctx, wasmPath, manifestPath, filepath.Base(path), sc))
	}
	return out, nil
}

func runOne(ctx context.Context, wasmPath, manifestPath, file string, sc Scenario) Result {
	res := Result{File: file, Scenario: sc.Name}

	mock := NewMockHost()

	// Install the mock HTTP transport on http.DefaultClient (which Extism's
	// built-in http_request uses). Restore on exit so scenarios are isolated.
	origTransport := http.DefaultClient.Transport
	if len(sc.Given.HTTPResponses) > 0 {
		fixtures := make([]HTTPFixture, len(sc.Given.HTTPResponses))
		for i, f := range sc.Given.HTTPResponses {
			fixtures[i] = HTTPFixture{
				URLPattern: f.URL, Method: f.Method,
				Status: f.Status, Headers: f.Headers, Body: f.Body,
			}
		}
		mock.SetHTTPFixtures(fixtures)
	}
	if sc.Given.Stream != nil {
		mock.SetStreamCurrent(*sc.Given.Stream)
	}
	if sc.Given.Server != nil {
		mock.SetServerInfo(*sc.Given.Server)
	}
	if sc.Given.ChatHistory != nil {
		mock.SetChatHistory(sc.Given.ChatHistory)
	}
	if sc.Given.ChatClients != nil {
		mock.SetChatClients(sc.Given.ChatClients)
	}
	if sc.Given.Users != nil {
		mock.SetUsers(sc.Given.Users)
	}
	if sc.Given.Socials != nil {
		mock.SetSocials(sc.Given.Socials)
	}
	if sc.Given.Federation != nil {
		mock.SetFederation(*sc.Given.Federation)
	}
	if sc.Given.Broadcaster != nil {
		mock.SetBroadcaster(*sc.Given.Broadcaster)
	}
	if sc.Given.Tags != nil {
		mock.SetTags(sc.Given.Tags)
	}
	if sc.Given.VideoConfig != nil {
		mock.SetVideoConfig(*sc.Given.VideoConfig)
	}
	http.DefaultClient.Transport = mock.HTTPTransport()
	defer func() { http.DefaultClient.Transport = origTransport }()

	loaded, err := plugin.LoadPlugin(ctx, mock.HostEnv(), wasmPath, manifestPath)
	if err != nil {
		res.Errors = append(res.Errors, fmt.Sprintf("load plugin: %v", err))
		return res
	}
	defer loaded.Close(ctx)

	dispatcher := plugin.NewDispatcher([]*plugin.Loaded{loaded})

	// SeedKV + checkExpectations key on slug so the mock storage matches
	// what real host fns (KV namespace, action storage) use.
	pluginSlug := loaded.Manifest.Slug
	if err := mock.SeedKV(pluginSlug, sc.Given.KV); err != nil {
		res.Errors = append(res.Errors, fmt.Sprintf("seed kv: %v", err))
		return res
	}

	// LoadPlugin doesn't auto-populate AssetsFS (only the Manager's full
	// LoadAll does, since it knows the on-disk layout). For HTTP scenarios
	// to find static assets, mount the project-local assets/ directory if
	// present, this matches what owncast-plugin build symlinks into place.
	assetsDir := filepath.Join(filepath.Dir(wasmPath), "assets")
	if info, err := os.Stat(assetsDir); err == nil && info.IsDir() {
		loaded.AssetsFS = os.DirFS(assetsDir)
	}
	server := plugin.NewServer([]*plugin.Loaded{loaded})
	server.IsAuthenticated = mock.IsAuthenticated
	server.GetRequestUser = mock.GetRequestUser

	for i, step := range sc.Steps {
		if err := runStep(ctx, dispatcher, server, loaded, step); err != nil {
			res.Errors = append(res.Errors, fmt.Sprintf("step %d: %v", i, err))
		}
	}

	checkExpectations(&res, &sc.Expect, mock, pluginSlug)

	res.Pass = len(res.Errors) == 0
	return res
}

func runStep(ctx context.Context, d *plugin.Dispatcher, server *plugin.Server, loaded *plugin.Loaded, step ScenarioStep) error {
	if step.HTTP != nil {
		return runHTTPStep(server, loaded.Manifest.Slug, step.HTTP)
	}
	if step.Filter != "" {
		final, allowed, reason := d.Filter(ctx, step.Filter, step.Payload)
		if step.Expect == nil {
			return nil
		}
		switch step.Expect.Action {
		case string(plugin.FilterPass):
			if !allowed {
				return fmt.Errorf("expected pass, got drop (reason=%q)", reason)
			}
			if !deepEqualJSON(final, step.Payload) {
				return fmt.Errorf("expected pass with payload unchanged, got %s", asJSON(final))
			}
		case string(plugin.FilterModify):
			if !allowed {
				return fmt.Errorf("expected modify, got drop (reason=%q)", reason)
			}
			if step.Expect.Payload != nil && !payloadMatches(step.Expect.Payload, final) {
				return fmt.Errorf("payload mismatch:\n  want %s\n  got  %s", asJSON(step.Expect.Payload), asJSON(final))
			}
		case string(plugin.FilterDrop):
			if allowed {
				return fmt.Errorf("expected drop, got pass (final payload=%s)", asJSON(final))
			}
			if step.Expect.Reason != "" && step.Expect.Reason != reason {
				return fmt.Errorf("drop reason mismatch:\n  want %q\n  got  %q", step.Expect.Reason, reason)
			}
		default:
			return fmt.Errorf("unknown action %q (want pass/modify/drop)", step.Expect.Action)
		}
		return nil
	}
	d.Notify(ctx, step.Event, step.Payload)
	return nil
}

func runHTTPStep(server *plugin.Server, pluginName string, h *HTTPStep) error {
	method := h.Method
	if method == "" {
		method = http.MethodGet
	}
	path := h.Path
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	url := "/plugins/" + pluginName + path
	var body io.Reader
	if h.Body != "" {
		body = strings.NewReader(h.Body)
	}
	req := httptest.NewRequest(method, url, body)
	for k, v := range h.Headers {
		req.Header.Set(k, v)
	}
	if h.Authenticated {
		req.Header.Set("X-Test-Admin", "1")
	}
	if h.User != nil {
		userJSON, _ := json.Marshal(h.User)
		req.Header.Set("X-Test-User", string(userJSON))
	}
	rec := httptest.NewRecorder()
	server.ServeHTTP(rec, req)

	if h.Expect == nil {
		return nil
	}
	if h.Expect.Status != 0 && h.Expect.Status != rec.Code {
		return fmt.Errorf("http status: want %d got %d (body=%q)", h.Expect.Status, rec.Code, rec.Body.String())
	}
	for k, want := range h.Expect.Headers {
		got := rec.Header().Get(k)
		if got != want {
			return fmt.Errorf("http header %q: want %q got %q", k, want, got)
		}
	}
	if h.Expect.Body != "" && h.Expect.Body != rec.Body.String() {
		return fmt.Errorf("http body:\n  want %q\n  got  %q", h.Expect.Body, rec.Body.String())
	}
	return nil
}

func checkExpectations(res *Result, e *ScenarioExpect, mock *MockHost, pluginName string) {
	if e.ChatSends != nil {
		got := mock.ChatSends()
		// Treat nil and empty-slice as equivalent: scenarios commonly write
		// "chatSends": [] to assert "no chat sends happened" and the recorded
		// slice may be nil if no callback fired.
		if !(len(e.ChatSends) == 0 && len(got) == 0) && !reflect.DeepEqual(e.ChatSends, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("chatSends mismatch:\n  want %v\n  got  %v", e.ChatSends, got))
		}
	}
	if e.ChatActions != nil {
		got := mock.ChatActions()
		if !(len(e.ChatActions) == 0 && len(got) == 0) && !reflect.DeepEqual(e.ChatActions, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("chatActions mismatch:\n  want %v\n  got  %v", e.ChatActions, got))
		}
	}
	if e.ChatSystems != nil {
		got := mock.ChatSystems()
		if !(len(e.ChatSystems) == 0 && len(got) == 0) && !reflect.DeepEqual(e.ChatSystems, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("chatSystems mismatch:\n  want %v\n  got  %v", e.ChatSystems, got))
		}
	}
	if e.DeletedMessages != nil {
		got := mock.DeletedMessages()
		if !(len(e.DeletedMessages) == 0 && len(got) == 0) && !reflect.DeepEqual(e.DeletedMessages, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("deletedMessages mismatch:\n  want %v\n  got  %v", e.DeletedMessages, got))
		}
	}
	if e.KickedClients != nil {
		got := mock.KickedClients()
		if !(len(e.KickedClients) == 0 && len(got) == 0) && !reflect.DeepEqual(e.KickedClients, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("kickedClients mismatch:\n  want %v\n  got  %v", e.KickedClients, got))
		}
	}
	if e.DiscordPosts != nil {
		got := mock.DiscordPosts()
		if !(len(e.DiscordPosts) == 0 && len(got) == 0) && !reflect.DeepEqual(e.DiscordPosts, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("discordPosts mismatch:\n  want %v\n  got  %v", e.DiscordPosts, got))
		}
	}
	if e.BrowserPushes != nil {
		got := mock.BrowserPushes()
		if len(e.BrowserPushes) != len(got) {
			res.Errors = append(res.Errors, fmt.Sprintf("browserPushes count: want %d got %d", len(e.BrowserPushes), len(got)))
		} else {
			for i, want := range e.BrowserPushes {
				if want.Title != got[i].Title || want.Body != got[i].Body || want.URL != got[i].URL {
					res.Errors = append(res.Errors, fmt.Sprintf("browserPushes[%d]: want %+v got %+v", i, want, got[i]))
				}
			}
		}
	}
	if e.UserModerations != nil {
		got := mock.UserModerations()
		if len(e.UserModerations) != len(got) {
			res.Errors = append(res.Errors, fmt.Sprintf("userModerations count: want %d got %d", len(e.UserModerations), len(got)))
		} else {
			for i, want := range e.UserModerations {
				g := got[i]
				if want.UserID != g.UserID || want.Enabled != g.Enabled || want.Reason != g.Reason {
					res.Errors = append(res.Errors, fmt.Sprintf("userModerations[%d]: want %+v got %+v", i, want, g))
				}
			}
		}
	}
	if e.BannedIPs != nil {
		got := mock.BannedIPs()
		if !(len(e.BannedIPs) == 0 && len(got) == 0) && !reflect.DeepEqual(e.BannedIPs, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("bannedIPs mismatch:\n  want %v\n  got  %v", e.BannedIPs, got))
		}
	}
	if e.Uploads != nil {
		got := mock.Uploads()
		if len(e.Uploads) != len(got) {
			res.Errors = append(res.Errors, fmt.Sprintf("uploads count: want %d got %d", len(e.Uploads), len(got)))
		} else {
			for i, want := range e.Uploads {
				g := got[i]
				if want.Name != g.Name {
					res.Errors = append(res.Errors, fmt.Sprintf("uploads[%d].name: want %q got %q", i, want.Name, g.Name))
				}
				if want.Body != "" && want.Body != string(g.Data) {
					res.Errors = append(res.Errors, fmt.Sprintf("uploads[%d].body:\n  want %q\n  got  %q", i, want.Body, string(g.Data)))
				}
			}
		}
	}
	if e.FediversePosts != nil {
		got := mock.FediversePosts()
		if len(e.FediversePosts) != len(got) {
			res.Errors = append(res.Errors, fmt.Sprintf("fediversePosts count: want %d got %d", len(e.FediversePosts), len(got)))
		} else {
			for i, want := range e.FediversePosts {
				g := got[i]
				if want.Type != g.Type || want.Body != g.Body || want.Image != g.Image || want.Link != g.Link {
					res.Errors = append(res.Errors, fmt.Sprintf("fediversePosts[%d]: want %+v got %+v", i, want, g))
				}
			}
		}
	}
	if e.ChatTo != nil {
		got := mock.ChatTo()
		if len(e.ChatTo) != len(got) {
			res.Errors = append(res.Errors, fmt.Sprintf("chatTo count: want %d got %d", len(e.ChatTo), len(got)))
		} else {
			for i, want := range e.ChatTo {
				if want.ClientID != got[i].ClientID || want.Text != got[i].Text {
					res.Errors = append(res.Errors, fmt.Sprintf("chatTo[%d]: want %+v got %+v", i, want, got[i]))
				}
			}
		}
	}
	if e.FediverseOutbox != nil {
		got := mock.FediverseOutbox()
		if !(len(e.FediverseOutbox) == 0 && len(got) == 0) && !reflect.DeepEqual(e.FediverseOutbox, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("fediverseOutbox mismatch:\n  want %v\n  got  %v", e.FediverseOutbox, got))
		}
	}
	if e.VideoConfigWrites != nil {
		got := mock.VideoConfigWrites()
		if !(len(e.VideoConfigWrites) == 0 && len(got) == 0) && !reflect.DeepEqual(e.VideoConfigWrites, got) {
			res.Errors = append(res.Errors, fmt.Sprintf("videoConfigWrites mismatch:\n  want %v\n  got  %v", e.VideoConfigWrites, got))
		}
	}
	if e.Emits != nil {
		got := mock.Emits()
		if len(got) != len(e.Emits) {
			res.Errors = append(res.Errors, fmt.Sprintf("emits count mismatch: want %d got %d", len(e.Emits), len(got)))
		} else {
			for i, want := range e.Emits {
				if want.EventType != got[i].EventType {
					res.Errors = append(res.Errors, fmt.Sprintf("emits[%d].eventType: want %q got %q", i, want.EventType, got[i].EventType))
				}
				if want.Payload != nil && !payloadMatches(want.Payload, got[i].Payload) {
					res.Errors = append(res.Errors, fmt.Sprintf("emits[%d].payload mismatch:\n  want %s\n  got  %s", i, asJSON(want.Payload), asJSON(got[i].Payload)))
				}
			}
		}
	}
	if e.KV != nil {
		got := mock.SnapshotKV(pluginName)
		keys := make([]string, 0, len(e.KV))
		for k := range e.KV {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if got[k] != e.KV[k] {
				res.Errors = append(res.Errors, fmt.Sprintf("kv[%q]: want %q got %q", k, e.KV[k], got[k]))
			}
		}
	}
	if e.HTTPRequests != nil {
		got := mock.HTTPRequests()
		if len(got) != len(e.HTTPRequests) {
			res.Errors = append(res.Errors, fmt.Sprintf("httpRequests count: want %d got %d", len(e.HTTPRequests), len(got)))
		} else {
			for i, want := range e.HTTPRequests {
				if want.URL != got[i].URL {
					res.Errors = append(res.Errors, fmt.Sprintf("httpRequests[%d].url: want %q got %q", i, want.URL, got[i].URL))
				}
				if want.Method != "" && want.Method != got[i].Method {
					res.Errors = append(res.Errors, fmt.Sprintf("httpRequests[%d].method: want %q got %q", i, want.Method, got[i].Method))
				}
				if want.Body != "" && want.Body != got[i].Body {
					res.Errors = append(res.Errors, fmt.Sprintf("httpRequests[%d].body:\n  want %q\n  got  %q", i, want.Body, got[i].Body))
				}
			}
		}
	}
}

// payloadMatches does a partial-deep-match: every field in `want` must be
// present and equal in `got`. Extra fields in `got` are ignored. This makes
// payload assertions resilient to fields plugin authors don't care about
// (e.g. id, timestamp on chat messages).
func payloadMatches(want, got any) bool {
	wantNorm := normalizeJSON(want)
	gotNorm := normalizeJSON(got)
	return partialMatch(wantNorm, gotNorm)
}

func partialMatch(want, got any) bool {
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			return false
		}
		for k, wv := range w {
			gv, ok := g[k]
			if !ok || !partialMatch(wv, gv) {
				return false
			}
		}
		return true
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			return false
		}
		for i := range w {
			if !partialMatch(w[i], g[i]) {
				return false
			}
		}
		return true
	default:
		return reflect.DeepEqual(want, got)
	}
}

// deepEqualJSON compares two values after a JSON round-trip so that
// map[string]any vs struct types compare structurally.
func deepEqualJSON(a, b any) bool {
	return reflect.DeepEqual(normalizeJSON(a), normalizeJSON(b))
}

func normalizeJSON(v any) any {
	b, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		return v
	}
	return out
}

func asJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
