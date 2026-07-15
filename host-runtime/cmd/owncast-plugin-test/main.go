// owncast-plugin-test runs scenario-based tests against a built plugin
// (.wasm + .manifest.json). It uses the same plugin runtime code that the
// production Owncast app uses, with mocked host functions injected, so
// passing tests here means the same plugin code path passes in production.
//
// Usage: owncast-plugin-test [--load-only] [<project-dir>]
//
// The plugin is always load-checked first — the same install-time path a real
// Owncast server runs (register(), manifest/runtime agreement, and
// permission-gated subscriptions such as chat.filter and fediverse.inbound) —
// so a plugin that would be rejected at install fails here even without
// scenario tests. --load-only stops after that check.
//
// Auto-discovers plugin.manifest.json, matching <slug>.wasm, and
// __tests__/*.test.json files in the project directory (default: cwd).
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	extism "github.com/extism/go-sdk"
	"github.com/owncast/owncast-plugin-sdk/host-runtime/plugin/testing"
	plugin "github.com/owncast/owncast/services/plugins"
)

// version is stamped at release time via -ldflags "-X main.version=v1.2.3".
var version = "dev"

func main() {
	projectDir := "."
	loadOnly := false
	for _, arg := range os.Args[1:] {
		switch {
		case isVersionArg(arg):
			fmt.Println("owncast-plugin-test", version)
			return
		case arg == "--load-only":
			loadOnly = true
		default:
			projectDir = arg
		}
	}
	abs, err := filepath.Abs(projectDir)
	if err != nil {
		fatal("resolve path: %v", err)
	}

	manifestPath := filepath.Join(abs, "plugin.manifest.json")
	if !exists(manifestPath) {
		fatal("no plugin.manifest.json in %s", abs)
	}
	// ParseManifest so the slug auto-derives from the display name when the
	// manifest omits it. The build artifact is found by its extension
	// (<slug>.js / <slug>.py / <slug>.wasm); its filename tells the host the
	// runtime, so the manifest declares no type.
	m, err := readManifest(manifestPath)
	if err != nil {
		fatal("read manifest: %v", err)
	}
	artifactPath, ok := findCodeArtifact(abs, m.Slug)
	if !ok {
		fatal("no %s.{js,py,wasm} in %s, run `owncast-plugin package` first", m.Slug, abs)
	}

	// Quiet extism's internal logging; only plugin console.log gets routed
	// via SetLogger inside LoadPlugin.
	extism.SetLogLevel(extism.LogLevelError)
	ctx := context.Background()

	// Load-check first, tests or not: this runs the same load path a real
	// Owncast server runs at install time (register(), manifest/runtime
	// agreement, permission-gated subscriptions), so a plugin that would be
	// rejected at install fails here even when it ships no scenario tests.
	if err := testing.LoadCheck(ctx, artifactPath, manifestPath); err != nil {
		fmt.Printf("FAIL  load: %v\n", err)
		os.Exit(1)
	}
	if loadOnly {
		fmt.Println("ok    plugin loads cleanly")
		return
	}

	testsDir := filepath.Join(abs, "__tests__")
	if !exists(testsDir) {
		fatal("no __tests__ directory in %s (plugin loads cleanly)", abs)
	}
	files, err := filepath.Glob(filepath.Join(testsDir, "*.test.json"))
	if err != nil {
		fatal("scan tests dir: %v", err)
	}
	if len(files) == 0 {
		fatal("no *.test.json files in %s (plugin loads cleanly)", testsDir)
	}

	pass, total := 0, 0
	for _, f := range files {
		rel, _ := filepath.Rel(abs, f)
		results, err := testing.RunFile(ctx, artifactPath, manifestPath, f)
		if err != nil {
			fmt.Printf("FAIL  %s\n        %v\n", rel, err)
			total++
			continue
		}
		for _, r := range results {
			total++
			if r.Pass {
				pass++
				fmt.Printf("ok    %s :: %s\n", rel, r.Scenario)
			} else {
				fmt.Printf("FAIL  %s :: %s\n", rel, r.Scenario)
				for _, e := range r.Errors {
					fmt.Printf("        %s\n", e)
				}
			}
		}
	}

	fmt.Printf("\n%d/%d passed\n", pass, total)
	if pass < total {
		os.Exit(1)
	}
}

// readManifest parses the on-disk manifest through the SDK's full validator so
// the slug auto-derives from the display name when omitted and the runtime type
// is normalized — keeping the binary's artifact lookup in lock-step with what
// the build CLI writes.
func readManifest(path string) (*plugin.Manifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return plugin.ParseManifest(data)
}

// findCodeArtifact locates a plugin's built code artifact by extension —
// <slug>.js (JavaScript), <slug>.py (Python), or <slug>.wasm (self-contained).
// The extension is what tells the host the runtime; LoadPlugin infers it.
func findCodeArtifact(dir, slug string) (string, bool) {
	for _, ext := range []string{".js", ".py", ".wasm"} {
		p := filepath.Join(dir, slug+ext)
		if exists(p) {
			return p, true
		}
	}
	return "", false
}

func isVersionArg(arg string) bool {
	return arg == "--version" || arg == "-version" || arg == "version"
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "owncast-plugin-test: "+format+"\n", args...)
	os.Exit(2)
}
