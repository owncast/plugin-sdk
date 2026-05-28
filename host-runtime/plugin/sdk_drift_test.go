package plugin

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

// TestSDKDoesNotDriftFromHostFns guards against the failure mode that
// originally bit us: adding a host function in hostfns.go but forgetting
// to expose it in the JS SDK wrapper or the build CLI's import-list
// generator. Either oversight makes the host function unreachable from
// plugin code, and the symptom (`permission 'X' not granted`) misleads.
//
// The test source-scans rather than introspecting the runtime: it parses
// the set of `"owncast_*"` host function names declared in hostfns.go,
// then asserts every name appears in sdks/js/index.js (the wrapper) and
// sdks/js/bin/owncast-plugin.js (the imports the bundler emits). A
// missing reference in either fails the build.
//
// If a name should *not* appear in the SDK (host-only internal), add it
// to expectedSDKExceptions below with a comment.
func TestSDKDoesNotDriftFromHostFns(t *testing.T) {
	hostFns := hostFunctionNames(t)
	if len(hostFns) == 0 {
		t.Fatal("no owncast_* host functions found, pattern broken?")
	}

	indexJS := readRepoFile(t, "sdks/js/index.js")
	buildCLI := readRepoFile(t, "sdks/js/bin/owncast-plugin.js")

	var missingSDK, missingBuild []string
	for _, name := range hostFns {
		if expectedSDKExceptions[name] {
			continue
		}
		if !strings.Contains(indexJS, name) {
			missingSDK = append(missingSDK, name)
		}
		if !strings.Contains(buildCLI, name) {
			missingBuild = append(missingBuild, name)
		}
	}

	if len(missingSDK) > 0 {
		t.Errorf("host functions missing from sdks/js/index.js:\n  %s\nadd a wrapper or update expectedSDKExceptions if intentional",
			strings.Join(missingSDK, "\n  "))
	}
	if len(missingBuild) > 0 {
		t.Errorf("host functions missing from sdks/js/bin/owncast-plugin.js (build CLI's import list):\n  %s\nadd an imports.push() entry for the right permission",
			strings.Join(missingBuild, "\n  "))
	}
}

// expectedSDKExceptions lists host fn names that legitimately don't appear
// in the SDK source (none today; keep the lever for future internal-only
// host calls).
var expectedSDKExceptions = map[string]bool{}

var hostFnNamePattern = regexp.MustCompile(`"(owncast_[a-z_]+)"`)

func hostFunctionNames(t *testing.T) []string {
	t.Helper()
	src := readRepoFile(t, "host-runtime/plugin/hostfns.go")
	seen := map[string]bool{}
	for _, match := range hostFnNamePattern.FindAllStringSubmatch(src, -1) {
		seen[match[1]] = true
	}
	out := make([]string, 0, len(seen))
	for name := range seen {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// readRepoFile returns the contents of a path relative to the repo root.
// Uses runtime.Caller to locate this test file, then walks up to find the
// repo root regardless of where `go test` was invoked.
func readRepoFile(t *testing.T, relPath string) string {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..")
	full := filepath.Join(repoRoot, relPath)
	data, err := os.ReadFile(full)
	if err != nil {
		t.Fatalf("read %s: %v", relPath, err)
	}
	return string(data)
}
