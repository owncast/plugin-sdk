// owncast-plugin-serve runs a single plugin behind a localhost dev server,
// reusing the same routing and security as the production plugin.Server.
// Plugin authors hit http://localhost:8080/plugins/<name>/... in their
// browser or curl while iterating.
//
// Usage: owncast-plugin-serve [<project-dir-or-ocpkg>]
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	extism "github.com/extism/go-sdk"
	"github.com/owncast/owncast-plugin-sdk/host-runtime-poc/kv"
	"github.com/owncast/owncast-plugin-sdk/host-runtime-poc/plugin"
)

const defaultPort = "8080"

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

	store := kv.NewMemory() // dev server: no persistence; restart = clean state
	env := &plugin.HostEnv{
		KV: store,
		OnChat: func(req plugin.ChatSendRequest) {
			switch req.Kind {
			case plugin.ChatSendAction:
				fmt.Fprintf(os.Stderr, "[chat.action] *%s*\n", req.Text)
			case plugin.ChatSendSystem:
				fmt.Fprintf(os.Stderr, "[chat.system] %s\n", req.Text)
			default:
				fmt.Fprintf(os.Stderr, "[chat.send] %s\n", req.Text)
			}
		},
		StreamCurrent: func() plugin.StreamInfo {
			return plugin.StreamInfo{Online: false}
		},
		ServerInfo: func() plugin.ServerInfo {
			return plugin.ServerInfo{
				Name:    "owncast-plugin-serve",
				Version: "0.1.0",
			}
		},
		// Dev convenience: any request with `Authorization: Bearer admin`
		// is treated as an authenticated admin. Real Owncast wires this
		// to its actual auth middleware.
		IsAuthenticated: func(r *http.Request) bool {
			return r.Header.Get("Authorization") == "Bearer admin"
		},
	}

	loaded, name, assetsDescription := loadTarget(ctx, env, abs)
	defer loaded.Close(ctx)

	dispatcher := plugin.NewDispatcher([]*plugin.Loaded{loaded})
	env.Emit = dispatcher.Dispatch

	server := plugin.NewServer([]*plugin.Loaded{loaded})
	server.IsAuthenticated = env.IsAuthenticated

	mux := http.NewServeMux()
	mux.Handle("/plugins/", logging(server))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "owncast-plugin-serve: dev server for %q\n\nTry: %s\n",
			name, fmt.Sprintf("http://localhost:%s/plugins/%s/", port, name))
	})

	fmt.Printf("owncast-plugin-serve: %s @ http://localhost:%s/plugins/%s/\n", name, port, name)
	if assetsDescription != "" {
		fmt.Printf("  static assets: %s\n", assetsDescription)
	}
	fmt.Println("  Ctrl-C to stop")
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		fatal("listen: %v", err)
	}
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
