// owncast-plugin-serve runs a single plugin behind a localhost dev server,
// reusing the same routing and security as the production plugin.Server.
// Plugin authors hit http://localhost:8080/plugins/<name>/... in their
// browser or curl while iterating.
//
// Beyond serving the plugin's HTTP routes, it stands in for a whole Owncast
// instance so authors can exercise every kind of plugin locally:
//
//   - All host functions are wired with realistic dev stubs (server info,
//     users, socials, federation, stream state), so a plugin that reads any
//     of them gets plausible data instead of empty values.
//   - chat.history() is backed by an in-memory log that the plugin's own
//     chat.send posts feed into.
//   - A small dev-only API drives the plugin's event and filter handlers,
//     which a pure HTTP server can't otherwise reach. See the /_dev/ routes
//     registered in main: POST /_dev/chat runs the filter chain then fires
//     chat.message.received, GET /_dev/chat returns the log, and
//     POST /_dev/event dispatches an arbitrary event.
//
// Usage: owncast-plugin-serve [<project-dir-or-ocpkg>]
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	extism "github.com/extism/go-sdk"
	"github.com/owncast/owncast-plugin-sdk/host-runtime/kv"
	"github.com/owncast/owncast-plugin-sdk/host-runtime/plugin"
)

const defaultPort = "8080"

// devChatLogLimit caps the in-memory chat log so a long-running dev session
// doesn't grow unbounded. Plenty for exercising chat.history().
const devChatLogLimit = 500

func main() {
	target := "."
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	if len(os.Args) > 1 {
		target = os.Args[1]
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		fatal("resolve path: %v", err)
	}

	ctx := context.Background()
	extism.SetLogLevel(extism.LogLevelError)

	dev := &devState{}
	store := kv.NewMemory() // dev server: no persistence; restart = clean state
	env := &plugin.HostEnv{
		KV:     store,
		OnChat: dev.onPluginChat,

		// Read-only server/stream state. Sample values so a plugin that
		// gates on them (server.read) has something plausible to work with.
		StreamCurrent: func() plugin.StreamInfo {
			return plugin.StreamInfo{
				Online:       true,
				Title:        "owncast-plugin-serve dev stream",
				Summary:      "Sample stream state from the local dev server",
				Viewers:      3,
				StartedAt:    time.Now().Add(-5 * time.Minute).UTC().Format(time.RFC3339),
				LatencyLevel: 2,
			}
		},
		ServerInfo: func() plugin.ServerInfo {
			return plugin.ServerInfo{
				Name:           "owncast-plugin-serve",
				URL:            "http://localhost:" + port,
				Summary:        "Local Owncast plugin dev server",
				WelcomeMessage: "Welcome to the dev server",
				Version:        "0.1.0",
			}
		},
		Socials: func() []plugin.SocialHandle {
			return []plugin.SocialHandle{
				{Platform: "mastodon", URL: "https://example.social/@dev"},
			}
		},
		Federation: func() plugin.FederationInfo {
			return plugin.FederationInfo{Enabled: true, Username: "dev"}
		},

		// Chat reads. ChatHistory is backed by the dev log; ChatClients is a
		// single sample connection so chat.clients() isn't empty.
		ChatHistory: dev.history,
		ChatClients: func() []plugin.HostChatClient {
			return []plugin.HostChatClient{
				{ID: 1, UserID: "u-alice", DisplayName: "alice", MessageCount: 1},
			}
		},

		// User reads. A small fixed roster so users.read plugins work.
		Users: func() []plugin.HostUser {
			return sampleUsers()
		},
		UserGet: func(id string) (plugin.HostUser, bool) {
			for _, u := range sampleUsers() {
				if u.ID == id {
					return u, true
				}
			}
			return plugin.HostUser{}, false
		},

		// Side-effecting hooks: in a real Owncast these moderate users,
		// kick clients, and send notifications. The dev server can't do any
		// of that, so it logs the intent to stderr for the author to see.
		DeleteMessage: func(pluginName, messageID string) {
			logHostCall("chat.delete", pluginName, "message %s", messageID)
		},
		KickClient: func(pluginName string, clientID uint64) {
			logHostCall("chat.kick", pluginName, "client %d", clientID)
		},
		SetUserEnabled: func(pluginName, userID string, enabled bool, reason string) {
			state := "enabled"
			if !enabled {
				state = "disabled"
			}
			logHostCall("users.setEnabled", pluginName, "%s → %s (%s)", userID, state, reason)
		},
		BanIP: func(pluginName, ip string) {
			logHostCall("users.banIP", pluginName, "%s", ip)
		},
		SendDiscord: func(pluginName, text string) {
			logHostCall("notify.discord", pluginName, "%s", text)
		},
		SendBrowserPush: func(pluginName string, p plugin.BrowserPushPayload) {
			logHostCall("notify.push", pluginName, "%s: %s", p.Title, p.Body)
		},
		SendFediverse: func(pluginName string, p plugin.FediversePayload) {
			logHostCall("notify.fediverse", pluginName, "%s: %s", p.Type, p.Body)
		},
		SendChatTo: func(pluginName string, clientID uint64, text string) {
			logHostCall("chat.sendTo", pluginName, "client %d: %s", clientID, text)
		},
		PostFediverse: func(pluginName, text string) (string, error) {
			url := fmt.Sprintf("http://localhost:%s/dev-fediverse/%d", port, time.Now().Unix())
			logHostCall("fediverse.post", pluginName, "%s → %s", text, url)
			return url, nil
		},
		UploadStorage: func(pluginName, name string, data []byte) (string, error) {
			url := fmt.Sprintf("http://localhost:%s/dev-uploads/%s/%s", port, pluginName, name)
			logHostCall("storage.upload", pluginName, "%s (%d bytes) → %s", name, len(data), url)
			return url, nil
		},

		// Dev convenience: any request with `Authorization: Bearer admin`
		// is treated as an authenticated admin; `Bearer user:<name>` is seen
		// by plugins as a logged-in chat user (req.user). Real Owncast wires
		// these to its actual auth middleware.
		IsAuthenticated: func(r *http.Request) bool {
			return r.Header.Get("Authorization") == "Bearer admin"
		},
		GetRequestUser: devRequestUser,
	}

	loaded, name, assetsDescription := loadTarget(ctx, env, abs)
	defer loaded.Close(ctx)

	dispatcher := plugin.NewDispatcher([]*plugin.Loaded{loaded})
	dev.dispatcher = dispatcher
	dev.pluginName = name
	env.Emit = dispatcher.Dispatch

	sseHub := plugin.NewSSEHub()
	env.SSE = sseHub

	server := plugin.NewServer([]*plugin.Loaded{loaded})
	server.IsAuthenticated = env.IsAuthenticated
	server.SSE = sseHub

	mux := http.NewServeMux()
	mux.Handle("/plugins/", logging(server))
	mux.HandleFunc("/_dev/chat", dev.handleChat)
	mux.HandleFunc("/_dev/event", dev.handleEvent)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		writeIndex(w, name, port)
	})

	fmt.Printf("owncast-plugin-serve: %s @ http://localhost:%s/plugins/%s/\n", name, port, name)
	if assetsDescription != "" {
		fmt.Printf("  static assets: %s\n", assetsDescription)
	}
	fmt.Printf("  drive chat:  curl -XPOST localhost:%s/_dev/chat -d '{\"user\":\"alice\",\"body\":\"hi\"}'\n", port)
	fmt.Printf("  drive event: curl -XPOST localhost:%s/_dev/event -d '{\"type\":\"stream.started\",\"payload\":{}}'\n", port)
	fmt.Println("  Ctrl-C to stop")
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		fatal("listen: %v", err)
	}
}

// devState holds the dev server's mutable, in-memory stand-ins for Owncast
// state (right now just the chat log) plus the dispatcher used to drive the
// loaded plugin's event and filter handlers.
type devState struct {
	mu         sync.Mutex
	chatLog    []plugin.HostChatMessage
	nextID     int
	dispatcher *plugin.Dispatcher
	pluginName string
}

// record appends a message to the in-memory chat log and returns it.
func (d *devState) record(user, body string) plugin.HostChatMessage {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.nextID++
	msg := plugin.HostChatMessage{
		ID:        fmt.Sprintf("dev-%d", d.nextID),
		User:      user,
		Body:      body,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	d.chatLog = append(d.chatLog, msg)
	if len(d.chatLog) > devChatLogLimit {
		d.chatLog = d.chatLog[len(d.chatLog)-devChatLogLimit:]
	}
	return msg
}

// history returns the most recent `limit` messages, oldest first.
func (d *devState) history(limit int) []plugin.HostChatMessage {
	d.mu.Lock()
	defer d.mu.Unlock()
	if limit <= 0 || limit > len(d.chatLog) {
		limit = len(d.chatLog)
	}
	out := make([]plugin.HostChatMessage, limit)
	copy(out, d.chatLog[len(d.chatLog)-limit:])
	return out
}

// onPluginChat backs the OnChat host hook: a plugin posted to chat. Log it
// for the author and record it so chat.history() reflects bot output.
func (d *devState) onPluginChat(req plugin.ChatSendRequest) {
	switch req.Kind {
	case plugin.ChatSendAction:
		fmt.Fprintf(os.Stderr, "[chat.action by %s] *%s*\n", req.PluginName, req.Text)
	case plugin.ChatSendSystem:
		fmt.Fprintf(os.Stderr, "[chat.system by %s] %s\n", req.PluginName, req.Text)
	default:
		fmt.Fprintf(os.Stderr, "[chat.send by %s] %s\n", req.PluginName, req.Text)
	}
	d.record(req.PluginName, req.Text)
}

// handleChat drives the loaded plugin's chat handling end to end: it runs the
// filter chain (on_filter) and, if the message is allowed, records the
// (possibly rewritten) message and fires the chat.message.received event
// (on_event). The JSON response shows the author exactly what their filter did.
func (d *devState) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"messages": d.history(0)})
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		User string `json:"user"`
		Body string `json:"body"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if body.User == "" {
		body.User = "dev-user"
	}

	payload := map[string]any{"user": body.User, "body": body.Body}
	final, allowed, reason := d.dispatcher.Filter(r.Context(), plugin.EventChatMessageReceived, payload)
	if !allowed {
		writeJSON(w, http.StatusOK, map[string]any{
			"allowed": false,
			"reason":  reason,
		})
		return
	}

	// The filter may have rewritten the body; persist and dispatch that.
	finalBody := body.Body
	if m, ok := final.(map[string]any); ok {
		if b, ok := m["body"].(string); ok {
			finalBody = b
		}
	}
	msg := d.record(body.User, finalBody)
	d.dispatcher.Dispatch(r.Context(), plugin.EventChatMessageReceived, final)

	writeJSON(w, http.StatusOK, map[string]any{
		"allowed": true,
		"reason":  reason,
		"message": msg,
	})
}

// handleEvent dispatches an arbitrary event to the loaded plugin's on_event
// handler, letting the author exercise stream/fediverse/custom subscriptions.
func (d *devState) handleEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Type    string `json:"type"`
		Payload any    `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.Type) == "" {
		http.Error(w, "event type is required", http.StatusBadRequest)
		return
	}
	d.dispatcher.Dispatch(r.Context(), body.Type, body.Payload)
	writeJSON(w, http.StatusOK, map[string]any{"dispatched": body.Type})
}

// sampleUsers is the fixed dev roster returned by Users()/UserGet().
func sampleUsers() []plugin.HostUser {
	return []plugin.HostUser{
		{ID: "u-alice", DisplayName: "alice", IsAuthenticated: true},
		{ID: "u-bob", DisplayName: "bob"},
	}
}

// devRequestUser maps `Authorization: Bearer user:<name>` to a logged-in chat
// user so plugins can test their req.user handling. Admin requests
// (`Bearer admin`) and anonymous requests get no user.
func devRequestUser(r *http.Request) *plugin.HostUser {
	const prefix = "Bearer user:"
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, prefix) {
		return nil
	}
	name := strings.TrimSpace(auth[len(prefix):])
	if name == "" {
		return nil
	}
	return &plugin.HostUser{
		ID:              "u-" + name,
		DisplayName:     name,
		IsAuthenticated: true,
	}
}

func logHostCall(hook, pluginName, format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[%s by %s] %s\n", hook, pluginName, fmt.Sprintf(format, args...))
}

func writeIndex(w http.ResponseWriter, name, port string) {
	body := fmt.Sprintf(`owncast-plugin-serve: dev server for %[1]q

Plugin HTTP:  http://localhost:%[2]s/plugins/%[1]s/
Drive chat:   POST /_dev/chat   {"user":"alice","body":"hi"}
Read chat:    GET  /_dev/chat
Drive event:  POST /_dev/event  {"type":"stream.started","payload":{}}
`, name, port)
	_, _ = io.WriteString(w, body)
}

// loadTarget loads the plugin from either a project directory (loose files:
// plugin.manifest.json + <name>.wasm + optional assets/) or a packaged
// .ocpkg file. Returns the loaded plugin, its declared name, and a
// human-readable description of where assets came from.
func loadTarget(ctx context.Context, env *plugin.HostEnv, target string) (*plugin.Loaded, string, string) {
	info, err := os.Stat(target)
	if err != nil {
		fatal("stat %s: %v", target, err)
	}

	if !info.IsDir() && strings.HasSuffix(target, ".ocpkg") {
		loaded, err := plugin.LoadPackage(ctx, env, target)
		if err != nil {
			fatal("load package: %v", err)
		}
		assets := ""
		if loaded.AssetsFS != nil {
			assets = "embedded in " + filepath.Base(target)
		}
		return loaded, loaded.Manifest.Name, assets
	}

	manifestPath := filepath.Join(target, "plugin.manifest.json")
	if !exists(manifestPath) {
		fatal("no plugin.manifest.json in %s", target)
	}
	name, err := readManifestName(manifestPath)
	if err != nil {
		fatal("read manifest: %v", err)
	}
	wasmPath := filepath.Join(target, name+".wasm")
	if !exists(wasmPath) {
		fatal("no %s.wasm in %s — run `npm run build` first", name, target)
	}

	loaded, err := plugin.LoadPlugin(ctx, env, wasmPath, manifestPath)
	if err != nil {
		fatal("load plugin: %v", err)
	}
	assetsDir := filepath.Join(target, "assets")
	assetsDescription := ""
	if info, err := os.Stat(assetsDir); err == nil && info.IsDir() {
		loaded.AssetsFS = os.DirFS(assetsDir)
		assetsDescription = assetsDir
	}
	return loaded, name, assetsDescription
}

func logging(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Printf("--> %s %s\n", r.Method, r.URL.Path)
		rr := &recordingResponseWriter{ResponseWriter: w, status: http.StatusOK}
		h.ServeHTTP(rr, r)
		fmt.Printf("<-- %d %s %s\n", rr.status, r.Method, r.URL.Path)
	})
}

type recordingResponseWriter struct {
	http.ResponseWriter
	status int
}

func (r *recordingResponseWriter) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func readManifestName(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var m struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return "", err
	}
	if strings.TrimSpace(m.Name) == "" {
		return "", fmt.Errorf("manifest.name is empty")
	}
	return m.Name, nil
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "owncast-plugin-serve: "+format+"\n", args...)
	os.Exit(2)
}
