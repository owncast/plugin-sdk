package plugin

import (
	"strings"
	"testing"
)

func TestParseManifest_Valid(t *testing.T) {
	in := []byte(`{
		"api": "1",
		"name": "demo",
		"version": "1.2.3",
		"description": "a demo plugin",
		"permissions": ["chat.send", "storage.kv"]
	}`)
	m, err := ParseManifest(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if m.Name != "demo" {
		t.Errorf("name: got %q want %q", m.Name, "demo")
	}
	if m.Version != "1.2.3" {
		t.Errorf("version: got %q want %q", m.Version, "1.2.3")
	}
	if len(m.Permissions) != 2 {
		t.Errorf("permissions: got %v want 2 entries", m.Permissions)
	}
}

func TestParseManifest_RejectsBadAPIVersion(t *testing.T) {
	in := []byte(`{"api": "99", "name": "x", "version": "1.0.0"}`)
	if _, err := ParseManifest(in); err == nil {
		t.Fatal("expected error for unsupported api version, got nil")
	} else if !strings.Contains(err.Error(), "unsupported api version") {
		t.Errorf("error mentions api version: got %v", err)
	}
}

func TestParseManifest_RequiresName(t *testing.T) {
	in := []byte(`{"api": "1", "version": "1.0.0"}`)
	if _, err := ParseManifest(in); err == nil {
		t.Fatal("expected error for missing name, got nil")
	} else if !strings.Contains(err.Error(), "name") {
		t.Errorf("error mentions name: got %v", err)
	}
}

func TestParseManifest_RequiresVersion(t *testing.T) {
	in := []byte(`{"api": "1", "name": "x"}`)
	if _, err := ParseManifest(in); err == nil {
		t.Fatal("expected error for missing version, got nil")
	} else if !strings.Contains(err.Error(), "version") {
		t.Errorf("error mentions version: got %v", err)
	}
}

func TestParseManifest_RejectsMalformedJSON(t *testing.T) {
	in := []byte(`{not valid json`)
	if _, err := ParseManifest(in); err == nil {
		t.Fatal("expected error for malformed json, got nil")
	}
}

func TestAgreesWith_HappyPath(t *testing.T) {
	sidecar := &Manifest{
		API: "1", Name: "demo", Version: "1.0.0",
		Permissions: []string{"chat.send", "storage.kv"},
	}
	runtime := &Manifest{
		API: "1", Name: "demo", Version: "1.0.0",
		Permissions: []string{"chat.send"}, // subset OK
	}
	if err := sidecar.AgreesWith(runtime); err != nil {
		t.Errorf("expected agreement, got error: %v", err)
	}
}

func TestAgreesWith_NameMismatch(t *testing.T) {
	sidecar := &Manifest{API: "1", Name: "demo", Version: "1.0.0"}
	runtime := &Manifest{API: "1", Name: "other", Version: "1.0.0"}
	err := sidecar.AgreesWith(runtime)
	if err == nil || !strings.Contains(err.Error(), "name mismatch") {
		t.Errorf("expected name mismatch error, got: %v", err)
	}
}

func TestAgreesWith_VersionMismatch(t *testing.T) {
	sidecar := &Manifest{API: "1", Name: "demo", Version: "1.0.0"}
	runtime := &Manifest{API: "1", Name: "demo", Version: "2.0.0"}
	err := sidecar.AgreesWith(runtime)
	if err == nil || !strings.Contains(err.Error(), "version mismatch") {
		t.Errorf("expected version mismatch error, got: %v", err)
	}
}

func TestAgreesWith_RuntimeExceedsDeclaredPermissions(t *testing.T) {
	sidecar := &Manifest{
		API: "1", Name: "demo", Version: "1.0.0",
		Permissions: []string{"chat.send"},
	}
	runtime := &Manifest{
		API: "1", Name: "demo", Version: "1.0.0",
		Permissions: []string{"chat.send", "events.emit"}, // events.emit not declared
	}
	err := sidecar.AgreesWith(runtime)
	if err == nil {
		t.Fatal("expected error for runtime claiming undeclared permission, got nil")
	}
	if !strings.Contains(err.Error(), "events.emit") {
		t.Errorf("error mentions the undeclared permission: got %v", err)
	}
}

func TestStrikeSystem_FilterFailuresAutoDisable(t *testing.T) {
	l := &Loaded{Manifest: &Manifest{Name: "x"}}
	for i := 0; i < FilterStrikeThreshold-1; i++ {
		if disabled := l.recordFilterFailure(); disabled {
			t.Fatalf("disabled too early at strike %d", i+1)
		}
		if l.IsDisabled() {
			t.Fatalf("IsDisabled() returned true at strike %d", i+1)
		}
	}
	if disabled := l.recordFilterFailure(); !disabled {
		t.Fatal("recordFilterFailure should have reported newly-disabled on the threshold strike")
	}
	if !l.IsDisabled() {
		t.Fatal("IsDisabled() should be true after threshold reached")
	}
	// Subsequent failures don't re-trigger the "newly disabled" signal.
	if disabled := l.recordFilterFailure(); disabled {
		t.Error("recordFilterFailure should not report newly-disabled twice")
	}
}

func TestStrikeSystem_SuccessResetsCounter(t *testing.T) {
	l := &Loaded{Manifest: &Manifest{Name: "x"}}
	// Rack up almost enough strikes to disable.
	for i := 0; i < FilterStrikeThreshold-1; i++ {
		l.recordFilterFailure()
	}
	// One success should reset the counter.
	l.recordFilterSuccess()
	if l.IsDisabled() {
		t.Fatal("success should have prevented auto-disable on the next failure batch")
	}
	// We can rack up failures again without tripping the threshold immediately.
	for i := 0; i < FilterStrikeThreshold-1; i++ {
		if disabled := l.recordFilterFailure(); disabled {
			t.Fatalf("disabled too early after reset, at strike %d", i+1)
		}
	}
}

func TestAgreesWith_SidecarMayDeclareMoreThanRuntimeUses(t *testing.T) {
	// The asymmetry: sidecar is the upper bound. Plugin author can declare
	// more than they end up using.
	sidecar := &Manifest{
		API: "1", Name: "demo", Version: "1.0.0",
		Permissions: []string{"chat.send", "storage.kv", "network.fetch"},
	}
	runtime := &Manifest{
		API: "1", Name: "demo", Version: "1.0.0",
		Permissions: []string{"chat.send"},
	}
	if err := sidecar.AgreesWith(runtime); err != nil {
		t.Errorf("sidecar should allow runtime to use subset of declared perms; got: %v", err)
	}
}
