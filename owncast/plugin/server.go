package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

// Server is an http.Handler that serves /plugins/<name>/* — first by
// looking for a static asset on the plugin's AssetsFS, then falling through
// to the plugin's on_http_request wasm export. Plugins without the
// http.serve permission produce 404 regardless.
//
// Asset storage is abstracted via io/fs so loose-files plugins (os.DirFS),
// packaged plugins (.ocpkg via zip.Reader), and any future layout share the
// same serving code.
//
// Mount this on the parent router at /plugins/, e.g.
//   mux.Handle("/plugins/", server)
type Server struct {
	// snapshot returns the currently-loaded plugins. Called per-request so
	// admin enable/disable takes effect immediately.
	snapshot func() []*Loaded
	// IsAuthenticated reports whether an incoming HTTP request carries
	// authenticated-admin credentials. Used to gate manifest.admin.pages
	// paths and to populate req.authenticated for dynamic handlers.
	// nil = always false (no auth available — admin paths return 401).
	IsAuthenticated func(*http.Request) bool
	// GetRequestUser returns the user identity attached to the request
	// (when the request came with a user-token, not admin auth). nil →
	// req.user is always omitted from the envelope.
	GetRequestUser func(*http.Request) *HostUser
}

// HTTP enforcement limits. Per-plugin, per-request.
const (
	MaxHTTPRequestBodyBytes  = 1 << 20  // 1 MB
	MaxHTTPResponseBodyBytes = 10 << 20 // 10 MB
)

// allowedResponseHeaders is the set of headers a plugin response is allowed
// to set. We block Set-Cookie, Authorization, and anything that could
// interfere with Owncast's auth or security context. CORS headers (Access-
// Control-*) are matched via prefix below.
var allowedResponseHeaders = map[string]bool{
	"content-type":     true,
	"content-encoding": true,
	"content-language": true,
	"cache-control":    true,
	"last-modified":    true,
	"etag":             true,
	"location":         true,
	"vary":             true,
	"link":             true,
}

func isAllowedResponseHeader(name string) bool {
	lower := strings.ToLower(name)
	if allowedResponseHeaders[lower] {
		return true
	}
	if strings.HasPrefix(lower, "access-control-") {
		return true
	}
	return false
}

// NewServer constructs an HTTP handler over a fixed plugin set. Used in
// tests and any context where the plugin set doesn't change after
// construction. Each plugin's AssetsFS is used for static asset serving;
// plugins with nil AssetsFS just don't serve static files.
func NewServer(loaded []*Loaded) *Server {
	snap := loaded
	return &Server{snapshot: func() []*Loaded { return snap }}
}

// NewLiveServer constructs an HTTP handler backed by a snapshot function —
// the Manager passes its Snapshot method here so admin enable/disable takes
// effect on subsequent requests without restarting the host.
func NewLiveServer(snapshot func() []*Loaded) *Server {
	return &Server{snapshot: snapshot}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Path: /plugins/<name>/<rest>. We're mounted at /plugins/, so
	// r.URL.Path starts with /plugins/. Strip and split.
	rel := strings.TrimPrefix(r.URL.Path, "/plugins/")
	parts := strings.SplitN(rel, "/", 2)
	if parts[0] == "" {
		http.NotFound(w, r)
		return
	}
	name := parts[0]
	p := s.lookup(name)
	if p == nil {
		http.NotFound(w, r)
		return
	}
	if !pluginHasPermission(p.Manifest, PermHttpServe) {
		http.NotFound(w, r)
		return
	}

	rest := "/"
	if len(parts) > 1 {
		rest = "/" + parts[1]
	}

	authenticated := false
	if s.IsAuthenticated != nil {
		authenticated = s.IsAuthenticated(r)
	}

	// Admin-only routes are auth-gated by the host before the plugin sees
	// the request. Plugins still get req.authenticated for fine-grained
	// gating, but they can't expose admin endpoints by accident.
	if p.IsAdminPath(rest) && !authenticated {
		w.Header().Set("WWW-Authenticate", `Basic realm="Owncast plugin admin"`)
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}

	if s.tryStatic(w, r, p, rest) {
		return
	}
	s.serveDynamic(w, r, p, rest, authenticated)
}

// lookup returns the currently-loaded plugin with the given name, or nil
// if there isn't one. Called per-request against the live snapshot.
func (s *Server) lookup(name string) *Loaded {
	for _, p := range s.snapshot() {
		if p.Manifest.Name == name {
			return p
		}
	}
	return nil
}

func pluginHasPermission(m *Manifest, perm string) bool {
	for _, p := range m.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}

func (s *Server) tryStatic(w http.ResponseWriter, r *http.Request, loaded *Loaded, requestPath string) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if loaded.AssetsFS == nil {
		return false
	}

	// fs.FS paths must be slash-separated, without a leading slash, and
	// can't contain ".." segments — path.Clean handles the first two; the
	// fs.ValidPath check rejects traversal.
	cleaned := strings.TrimPrefix(path.Clean("/"+requestPath), "/")
	if cleaned == "" {
		cleaned = "."
	}
	if !fs.ValidPath(cleaned) {
		return false
	}

	info, err := fs.Stat(loaded.AssetsFS, cleaned)
	if err != nil {
		return false
	}
	if info.IsDir() {
		indexPath := path.Join(cleaned, "index.html")
		idx, err := fs.Stat(loaded.AssetsFS, indexPath)
		if err != nil || idx.IsDir() {
			return false
		}
		serveAssetFile(w, r, loaded.AssetsFS, indexPath, idx)
		return true
	}
	serveAssetFile(w, r, loaded.AssetsFS, cleaned, info)
	return true
}

// serveAssetFile reads a file from the plugin's AssetsFS into memory and
// hands it to http.ServeContent. Reading into memory avoids the seekability
// problems with non-file-backed fs.FS implementations (zip entries aren't
// seekable as ReadClosers); plugin assets are small enough that this is
// fine in practice. http.ServeContent gives us correct content-type
// sniffing, range support, ETag/conditional-GET handling — without
// net/http.ServeFile's path-canonicalization redirects.
func serveAssetFile(w http.ResponseWriter, r *http.Request, root fs.FS, name string, info fs.FileInfo) {
	data, err := fs.ReadFile(root, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	modtime := info.ModTime()
	if modtime.IsZero() {
		modtime = time.Time{} // ServeContent skips Last-Modified if zero
	}
	http.ServeContent(w, r, path.Base(name), modtime, bytes.NewReader(data))
}

func (s *Server) serveDynamic(w http.ResponseWriter, r *http.Request, p *Loaded, requestPath string, authenticated bool) {
	// p.plugin can be nil during shutdown (Loaded.Close clears it) or in
	// tests that only exercise the static path. Either way, no plugin
	// instance means no dynamic handler.
	if p.plugin == nil || !p.plugin.FunctionExists("on_http_request") {
		http.NotFound(w, r)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, MaxHTTPRequestBodyBytes+1))
	if err != nil {
		http.Error(w, "request body read error", http.StatusBadRequest)
		return
	}
	if int64(len(body)) > MaxHTTPRequestBodyBytes {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return
	}

	envelope := map[string]any{
		"method":        r.Method,
		"path":          requestPath,
		"query":         flattenValues(r.URL.Query()),
		"headers":       flattenValues(r.Header),
		"body":          string(body),
		"remoteAddr":    r.RemoteAddr,
		"authenticated": authenticated,
	}
	if s.GetRequestUser != nil {
		if user := s.GetRequestUser(r); user != nil {
			envelope["user"] = user
		}
	}
	envelopeJSON, err := json.Marshal(envelope)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	callCtx, cancel := context.WithTimeout(r.Context(), HTTPHandlerTimeout)
	defer cancel()
	p.mu.Lock()
	_, out, err := p.plugin.CallWithContext(callCtx, "on_http_request", envelopeJSON)
	p.mu.Unlock()
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || callCtx.Err() == context.DeadlineExceeded {
			http.Error(w, "plugin timed out", http.StatusGatewayTimeout)
			fmt.Fprintf(os.Stderr, "plugin %s: on_http_request timed out after %s\n", p.Manifest.Name, HTTPHandlerTimeout)
			return
		}
		http.Error(w, "plugin error", http.StatusInternalServerError)
		fmt.Fprintf(os.Stderr, "plugin %s: on_http_request failed: %v\n", p.Manifest.Name, err)
		return
	}
	if len(out) > MaxHTTPHandlerOutputBytes {
		http.Error(w, "plugin response too large", http.StatusInternalServerError)
		fmt.Fprintf(os.Stderr, "plugin %s: on_http_request output too large: %d bytes (max %d)\n",
			p.Manifest.Name, len(out), MaxHTTPHandlerOutputBytes)
		return
	}

	var resp struct {
		Status  int               `json:"status"`
		Headers map[string]string `json:"headers"`
		Body    string            `json:"body"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		http.Error(w, "plugin returned invalid response", http.StatusInternalServerError)
		return
	}
	if resp.Status == 0 {
		resp.Status = http.StatusOK
	}
	if len(resp.Body) > MaxHTTPResponseBodyBytes {
		http.Error(w, "plugin response too large", http.StatusInternalServerError)
		return
	}

	for k, v := range resp.Headers {
		if !isAllowedResponseHeader(k) {
			continue
		}
		w.Header().Set(k, v)
	}
	w.WriteHeader(resp.Status)
	_, _ = io.WriteString(w, resp.Body)
}

func flattenValues(v map[string][]string) map[string]string {
	out := make(map[string]string, len(v))
	for k, vs := range v {
		if len(vs) > 0 {
			out[k] = vs[0]
		}
	}
	return out
}
