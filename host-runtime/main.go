package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	extism "github.com/extism/go-sdk"
	"github.com/owncast/owncast-plugin-sdk/host-runtime/kv"
	"github.com/owncast/owncast-plugin-sdk/host-runtime/plugin"
)

func extismSetLogLevel() {
	extism.SetLogLevel(extism.LogLevelInfo)
}

// isAuthenticatedHeader is the demo binary's auth predicate. Real Owncast
// would consult its session/admin-key middleware here. For the PoC, any
// request carrying `Authorization: Bearer admin` is treated as an
// authenticated admin.
func isAuthenticatedHeader(r *http.Request) bool {
	return r.Header.Get("Authorization") == "Bearer admin"
}

type ChatMessage struct {
	ID        string    `json:"id"`
	User      string    `json:"user"`
	Body      string    `json:"body"`
	Timestamp time.Time `json:"timestamp"`
}

func main() {
	pluginsDir := "./plugins"
	if len(os.Args) > 1 {
		pluginsDir = os.Args[1]
	}

	ctx := context.Background()
	extismSetLogLevel()

	store, err := kv.NewBolt(filepath.Join(pluginsDir, "..", "plugin-data.db"))
	if err != nil {
		log.Fatalf("open kv store: %v", err)
	}
	defer store.Close()

	env := &plugin.HostEnv{
		KV: store,
		OnChat: func(req plugin.ChatSendRequest) {
			// Identify the plugin in dev-host logs by display name when set,
			// otherwise the slug. Bot.DisplayName drives what would show in
			// chat in production; slug is the stable identifier.
			label := req.BotDisplayName
			if label == "" {
				label = req.PluginSlug
			}
			switch req.Kind {
			case plugin.ChatSendAction:
				fmt.Printf("[chat action from plugin %s] *%s*\n", label, req.Text)
			case plugin.ChatSendSystem:
				fmt.Printf("[system message from plugin %s] %s\n", label, req.Text)
			default:
				fmt.Printf("[chat from plugin %s] %s\n", label, req.Text)
			}
		},
		StreamCurrent: func() plugin.StreamInfo {
			return plugin.StreamInfo{
				Online:       true,
				Title:        "Live demo stream",
				Summary:      "PoC chat stream simulation",
				Viewers:      3,
				StartedAt:    time.Now().Add(-5 * time.Minute).UTC().Format(time.RFC3339),
				LatencyLevel: 2,
			}
		},
		ServerInfo: func() plugin.ServerInfo {
			return plugin.ServerInfo{
				Name:           "Demo Owncast",
				URL:            "https://demo.owncast.example",
				Summary:        "Owncast plugin runtime PoC",
				WelcomeMessage: "Welcome to the demo",
				Version:        "0.1.0",
			}
		},
		Users: func() []plugin.HostUser {
			return []plugin.HostUser{
				{ID: "u-alice", DisplayName: "alice"},
				{ID: "u-bob", DisplayName: "bob"},
			}
		},
		UserGet: func(id string) (plugin.HostUser, bool) {
			switch id {
			case "u-alice":
				return plugin.HostUser{ID: "u-alice", DisplayName: "alice"}, true
			case "u-bob":
				return plugin.HostUser{ID: "u-bob", DisplayName: "bob"}, true
			}
			return plugin.HostUser{}, false
		},
		SetUserEnabled: func(plugin, userID string, enabled bool, reason string) {
			state := "enabled"
			if !enabled {
				state = "disabled"
			}
			fmt.Printf("[users.setEnabled by %s] %s → %s (%s)\n", plugin, userID, state, reason)
		},
		BanIP: func(plugin, ip string) {
			fmt.Printf("[users.banIP by %s] %s\n", plugin, ip)
		},
		ChatClients: func() []plugin.HostChatClient {
			return nil // demo has no real chat-client connections
		},
		UploadStorage: func(pluginName, name string, data []byte) (string, error) {
			url := fmt.Sprintf("https://demo.owncast.example/uploads/%s/%s", pluginName, name)
			fmt.Printf("[storage.upload by %s] %s (%d bytes) → %s\n", pluginName, name, len(data), url)
			return url, nil
		},
		IsAuthenticated: isAuthenticatedHeader,
		Socials: func() []plugin.SocialHandle {
			return []plugin.SocialHandle{
				{Platform: "mastodon", URL: "https://example.social/@demo"},
			}
		},
		Federation: func() plugin.FederationInfo {
			return plugin.FederationInfo{Enabled: true, Username: "demo"}
		},
		SendFediverse: func(pluginName string, p plugin.FediversePayload) {
			fmt.Printf("[fediverse by %s] %s: %s\n", pluginName, p.Type, p.Body)
		},
		SendChatTo: func(pluginName string, clientID uint64, text string) {
			fmt.Printf("[chat.sendTo by %s → client %d] %s\n", pluginName, clientID, text)
		},
		PostFediverse: func(pluginName, text string) (string, error) {
			url := fmt.Sprintf("https://demo.owncast.example/@demo/%s/%d", pluginName, time.Now().Unix())
			fmt.Printf("[fediverse.post by %s] %s → %s\n", pluginName, text, url)
			return url, nil
		},
	}

	mgr := plugin.NewManager(pluginsDir, env)
	if err := mgr.Start(ctx); err != nil {
		log.Fatalf("start plugin manager: %v", err)
	}
	defer mgr.Stop(ctx)

	entries := mgr.List()
	loaded := mgr.Snapshot()
	fmt.Printf("Discovered %d plugin(s) from %s; %d loaded\n", len(entries), pluginsDir, len(loaded))
	for _, e := range entries {
		printEntry(e)
	}
	if len(loaded) == 0 {
		fmt.Println("\nNo plugins are enabled. Enable one via the admin API:")
		fmt.Println("  POST /api/admin/plugins/<name>/enable")
		return
	}

	dispatcher := plugin.NewLiveDispatcher(mgr.Snapshot)
	env.Emit = dispatcher.Dispatch

	// The SSE hub is shared: plugins publish through env.SSE (the
	// owncast.sse.send host function) and the plugin HTTP server holds the
	// browser connections that consume those events.
	sseHub := plugin.NewSSEHub()
	env.SSE = sseHub

	go func() {
		mux := http.NewServeMux()
		registerAdminRoutes(mux, mgr, ctx)
		pluginServer := plugin.NewLiveServer(mgr.Snapshot)
		pluginServer.SSE = sseHub
		mux.Handle("/plugins/", pluginServer)
		addr := ":8080"
		if env := os.Getenv("DEMO_HTTP_ADDR"); env != "" {
			addr = env
		}
		fmt.Printf("\nAdmin + plugin HTTP listening on %s\n", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Printf("http server: %v", err)
		}
	}()

	fmt.Println("\n--- simulating chat stream ---")
	t0 := time.Now()

	// 1) Stream goes live.
	fmt.Println("\n> stream.started")
	dispatcher.Dispatch(ctx, plugin.EventStreamStarted, map[string]any{
		"startedAt": t0.UTC().Format(time.RFC3339),
		"title":     "Live demo stream",
		"summary":   "PoC chat stream simulation",
	})

	// 2) Users join chat.
	fmt.Println("> chat.user.joined alice / bob")
	dispatcher.Dispatch(ctx, plugin.EventChatUserJoined, map[string]any{
		"id":          "u-alice",
		"displayName": "alice",
	})
	dispatcher.Dispatch(ctx, plugin.EventChatUserJoined, map[string]any{
		"id":          "u-bob",
		"displayName": "bob",
	})

	// 3) Chat traffic, exercises filter chain + notifications.
	messages := []ChatMessage{
		{ID: "1", User: "alice", Body: "hello world", Timestamp: t0},
		{ID: "2", User: "bob", Body: "what the hell, this is great", Timestamp: t0.Add(1 * time.Second)},
		{ID: "3", User: "alice", Body: "going great!", Timestamp: t0.Add(1500 * time.Millisecond)},
		{ID: "4", User: "alice", Body: "damn good content", Timestamp: t0.Add(4 * time.Second)},
		{ID: "5", User: "alice", Body: "/announce stream is live", Timestamp: t0.Add(7 * time.Second)},
		{ID: "6", User: "bob", Body: "!ip", Timestamp: t0.Add(10 * time.Second)},
		{ID: "7", User: "bob", Body: "!uptime", Timestamp: t0.Add(12 * time.Second)},
	}
	for _, msg := range messages {
		fmt.Printf("\n> [%s] %s: %q\n", msg.Timestamp.Sub(t0), msg.User, msg.Body)
		dispatcher.Dispatch(ctx, plugin.EventChatMessageReceived, msg)
	}

	// 4) Streamer changes the title mid-stream.
	fmt.Println("\n> stream.title.changed")
	dispatcher.Dispatch(ctx, plugin.EventStreamTitleChanged, map[string]any{
		"from": "Live demo stream",
		"to":   "Live demo stream, Q&A",
	})

	// 5) Bob leaves.
	fmt.Println("> chat.user.parted bob")
	dispatcher.Dispatch(ctx, plugin.EventChatUserParted, map[string]any{
		"id":          "u-bob",
		"displayName": "bob",
	})

	// 6) Stream ends.
	fmt.Println("> stream.stopped")
	dispatcher.Dispatch(ctx, plugin.EventStreamStopped, map[string]any{
		"stoppedAt": time.Now().UTC().Format(time.RFC3339),
	})

	// Keep the HTTP server (admin API + /plugins/<name>/* serving) alive
	// after the simulation so the demo is usable as a live playground.
	// Ctrl-C to exit.
	fmt.Println("\n--- simulation complete; HTTP server still running. Ctrl-C to exit ---")
	select {}
}

func printEntry(e plugin.DiscoveredEntry) {
	state := "discovered"
	switch {
	case e.Loaded:
		state = "loaded"
	case e.Enabled:
		state = "enabled (not loaded, see lastError)"
	}
	fmt.Printf("\n  %s [%s] v%s (%s)\n", e.DisplayName, e.Slug, e.Version, state)
	if e.Description != "" {
		fmt.Printf("    %s\n", e.Description)
	}
	if len(e.Permissions) > 0 {
		fmt.Printf("    permissions: %v\n", e.Permissions)
	}
	if e.LastError != "" {
		fmt.Printf("    last error: %s\n", e.LastError)
	}
}

// registerAdminRoutes wires the demo admin API. Real Owncast would integrate
// this into its existing admin auth + router; here it's behind the same
// "Authorization: Bearer admin" header that gates plugin HTTP admin paths.
func registerAdminRoutes(mux *http.ServeMux, mgr *plugin.Manager, ctx context.Context) {
	requireAdmin := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !isAuthenticatedHeader(r) {
				w.Header().Set("WWW-Authenticate", `Bearer realm="Owncast admin"`)
				http.Error(w, "authentication required", http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}

	mux.HandleFunc("/api/admin/plugins", requireAdmin(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, http.StatusOK, mgr.List())
	}))

	// GET /api/plugins/actions, merged ExternalAction-shaped list from every
	// loaded plugin. Public on purpose; the Owncast frontend folds these into
	// the same list it already gets from /api/externalactions. No auth.
	mux.HandleFunc("/api/plugins/actions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var merged []plugin.ActionButton
		for _, p := range mgr.Snapshot() {
			merged = append(merged, p.Manifest.Actions...)
		}
		if merged == nil {
			merged = []plugin.ActionButton{}
		}
		writeJSON(w, http.StatusOK, merged)
	})

	// POST /api/admin/plugins/<name>/{enable,disable,reload}
	// GET  /api/admin/plugins/<name>/instructions
	mux.HandleFunc("/api/admin/plugins/", requireAdmin(func(w http.ResponseWriter, r *http.Request) {
		rest := r.URL.Path[len("/api/admin/plugins/"):]
		slash := -1
		for i := 0; i < len(rest); i++ {
			if rest[i] == '/' {
				slash = i
				break
			}
		}
		if slash < 0 {
			http.Error(w, "expected /<name>/<action>", http.StatusBadRequest)
			return
		}
		name, action := rest[:slash], rest[slash+1:]

		// GET <name>/instructions serves the bundled INSTRUCTIONS.md as raw
		// markdown; the admin UI renders it in a details tab.
		if action == "instructions" {
			if r.Method != http.MethodGet {
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			data, err := mgr.InstructionsBytes(name)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			_, _ = w.Write(data)
			return
		}

		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var err error
		switch action {
		case "enable":
			err = mgr.Enable(ctx, name)
		case "disable":
			err = mgr.Disable(ctx, name)
		case "reload":
			err = mgr.Reload(ctx, name)
		default:
			http.Error(w, "unknown action; expected enable/disable/reload", http.StatusBadRequest)
			return
		}
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "name": name, "action": action})
	}))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
