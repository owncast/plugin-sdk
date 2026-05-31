package plugin

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gobwas/glob"
)

// makePluginFiles drops a sidecar wasm + manifest pair into dir. The manifest
// name is what the manager keys discovered/enabled state by.
func makePluginFiles(t *testing.T, dir, name string, wasmBytes []byte) {
	t.Helper()
	// Version must match what the bundled example's register() returns —
	// the host enforces manifest/runtime agreement at load time.
	manifest := map[string]any{
		"api":         "1",
		"name":        name,
		"version":     "0.1.0",
		"description": name + " for tests",
		"permissions": []string{},
	}
	mb, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name+".manifest.json"), mb, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name+".wasm"), wasmBytes, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestManager_DiscoversWithoutLoading(t *testing.T) {
	wasmPath := findExampleWasm(t)
	wasmBytes, err := os.ReadFile(wasmPath)
	if err != nil {
		t.Fatalf("read example wasm: %v", err)
	}

	dir := t.TempDir()
	makePluginFiles(t, dir, "hello-world", wasmBytes)

	mgr := NewManager(dir, &HostEnv{})
	if err := mgr.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer mgr.Stop(context.Background())

	entries := mgr.List()
	if len(entries) != 1 {
		t.Fatalf("expected 1 discovered, got %d", len(entries))
	}
	if entries[0].Slug != "hello-world" {
		t.Errorf("slug: got %q want hello-world", entries[0].Slug)
	}
	if entries[0].Loaded {
		t.Error("plugin should not be loaded, admin never enabled it")
	}
	if entries[0].Enabled {
		t.Error("plugin should not be enabled, admin never enabled it")
	}
	if len(mgr.Snapshot()) != 0 {
		t.Errorf("snapshot should be empty for un-enabled plugin, got %d", len(mgr.Snapshot()))
	}
}

func TestManager_EnableLoadsAndPersists(t *testing.T) {
	wasmPath := findExampleWasm(t)
	wasmBytes, _ := os.ReadFile(wasmPath)

	dir := t.TempDir()
	makePluginFiles(t, dir, "hello-world", wasmBytes)

	ctx := context.Background()
	mgr := NewManager(dir, &HostEnv{})
	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}

	if err := mgr.Enable(ctx, "hello-world"); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if len(mgr.Snapshot()) != 1 {
		t.Errorf("snapshot count after enable: got %d want 1", len(mgr.Snapshot()))
	}

	// Persistence: stop, start a fresh manager, plugin should auto-load.
	mgr.Stop(ctx)

	mgr2 := NewManager(dir, &HostEnv{})
	if err := mgr2.Start(ctx); err != nil {
		t.Fatalf("restart: %v", err)
	}
	defer mgr2.Stop(ctx)

	if len(mgr2.Snapshot()) != 1 {
		t.Errorf("snapshot count after restart: got %d want 1 (enabled set should persist)",
			len(mgr2.Snapshot()))
	}
}

func TestManager_DisableUnloadsButKeepsDiscovered(t *testing.T) {
	wasmPath := findExampleWasm(t)
	wasmBytes, _ := os.ReadFile(wasmPath)

	dir := t.TempDir()
	makePluginFiles(t, dir, "hello-world", wasmBytes)

	ctx := context.Background()
	mgr := NewManager(dir, &HostEnv{})
	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer mgr.Stop(ctx)

	if err := mgr.Enable(ctx, "hello-world"); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if err := mgr.Disable(ctx, "hello-world"); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if len(mgr.Snapshot()) != 0 {
		t.Errorf("snapshot after disable: got %d want 0", len(mgr.Snapshot()))
	}
	entries := mgr.List()
	if len(entries) != 1 {
		t.Errorf("discovered list after disable: got %d want 1", len(entries))
	}
	if entries[0].Enabled {
		t.Error("entry should not be marked enabled after disable")
	}
}

func TestManager_ScanRemovesDeletedFiles(t *testing.T) {
	wasmPath := findExampleWasm(t)
	wasmBytes, _ := os.ReadFile(wasmPath)

	dir := t.TempDir()
	makePluginFiles(t, dir, "hello-world", wasmBytes)

	ctx := context.Background()
	mgr := NewManager(dir, &HostEnv{})
	mgr.scanInterval = 20 * time.Millisecond
	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer mgr.Stop(ctx)

	if len(mgr.List()) != 1 {
		t.Fatalf("setup: expected 1 discovered, got %d", len(mgr.List()))
	}

	// Delete both files; the next scan should drop the entry.
	if err := os.Remove(filepath.Join(dir, "hello-world.wasm")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "hello-world.manifest.json")); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if len(mgr.List()) == 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Errorf("expected scan to drop deleted plugin within 2s, still have %d", len(mgr.List()))
}

func TestManager_EnableUnknownPluginErrors(t *testing.T) {
	dir := t.TempDir()
	mgr := NewManager(dir, &HostEnv{})
	if err := mgr.Start(context.Background()); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer mgr.Stop(context.Background())

	err := mgr.Enable(context.Background(), "does-not-exist")
	if err == nil {
		t.Error("expected error enabling unknown plugin")
	}
}

func TestLoaded_IsAdminPath(t *testing.T) {
	compile := func(paths ...string) *Loaded {
		t.Helper()
		l := &Loaded{}
		for _, p := range paths {
			g, err := glob.Compile(p)
			if err != nil {
				t.Fatalf("compile %q: %v", p, err)
			}
			l.adminGlobs = append(l.adminGlobs, g)
			l.adminPaths = append(l.adminPaths, p)
		}
		return l
	}

	cases := []struct {
		name      string
		pagePaths []string
		path      string
		wantGated bool
	}{
		{"literal page gates itself", []string{"/admin"}, "/admin", true},
		{"literal page gates trailing-slash variant", []string{"/admin"}, "/admin/", true},
		{"literal page gates descendant", []string{"/admin"}, "/admin/api/settings", true},
		{"literal page does not gate sibling prefix", []string{"/admin"}, "/administration", false},
		{"literal page does not gate unrelated path", []string{"/admin"}, "/public/index.html", false},
		{"glob page matches via wildcard", []string{"/admin/*"}, "/admin/foo", true},
		{"multiple pages: descendant of either gated", []string{"/admin", "/manage"}, "/manage/users", true},
		{"empty page list never gates", nil, "/admin", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			l := compile(tc.pagePaths...)
			if got := l.IsAdminPath(tc.path); got != tc.wantGated {
				t.Errorf("IsAdminPath(%q) with pages %v = %v, want %v", tc.path, tc.pagePaths, got, tc.wantGated)
			}
		})
	}
}
