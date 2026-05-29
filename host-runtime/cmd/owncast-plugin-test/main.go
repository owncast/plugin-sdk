// owncast-plugin-test runs scenario-based tests against a built plugin
// (.wasm + .manifest.json). It uses the same plugin runtime code that the
// production Owncast app uses, with mocked host functions injected, so
// passing tests here means the same plugin code path passes in production.
//
// Usage: owncast-plugin-test [<project-dir>]
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
	"github.com/owncast/owncast-plugin-sdk/host-runtime/plugin"
	"github.com/owncast/owncast-plugin-sdk/host-runtime/plugin/testing"
)

// version is stamped at release time via -ldflags "-X main.version=v1.2.3".
var version = "dev"

func main() {
	projectDir := "."
	if len(os.Args) > 1 {
		if isVersionArg(os.Args[1]) {
			fmt.Println("owncast-plugin-test", version)
			return
		}
		projectDir = os.Args[1]
	}
	abs, err := filepath.Abs(projectDir)
	if err != nil {
		fatal("resolve path: %v", err)
	}

	manifestPath := filepath.Join(abs, "plugin.manifest.json")
	if !exists(manifestPath) {
		fatal("no plugin.manifest.json in %s", abs)
	}
	// Use ParseManifest so the slug is auto-derived from the display
	// name when the manifest omits `slug`, matching what the build CLI
	// does when it writes <slug>.wasm.
	slug, err := readManifestSlug(manifestPath)
	if err != nil {
		fatal("read manifest: %v", err)
	}
	wasmPath := filepath.Join(abs, slug+".wasm")
	if !exists(wasmPath) {
		fatal("no %s.wasm in %s, run `owncast-plugin package` first", slug, abs)
	}
	testsDir := filepath.Join(abs, "__tests__")
	if !exists(testsDir) {
		fatal("no __tests__ directory in %s", abs)
	}
	files, err := filepath.Glob(filepath.Join(testsDir, "*.test.json"))
	if err != nil {
		fatal("scan tests dir: %v", err)
	}
	if len(files) == 0 {
		fatal("no *.test.json files in %s", testsDir)
	}

	// Quiet extism's internal logging during tests; only plugin console.log
	// gets routed via SetLogger inside LoadPlugin.
	extism.SetLogLevel(extism.LogLevelError)

	ctx := context.Background()
	pass, total := 0, 0
	for _, f := range files {
		rel, _ := filepath.Rel(abs, f)
		results, err := testing.RunFile(ctx, wasmPath, manifestPath, f)
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

// readManifestSlug parses the on-disk manifest through the SDK's full
// validator so the slug auto-derives from the display name when the
// manifest omits it, matching what the build CLI does when it writes
// <slug>.wasm. Returning the resolved slug keeps the binary's
// "where's my wasm" lookup in lock-step with the build output.
func readManifestSlug(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	m, err := plugin.ParseManifest(data)
	if err != nil {
		return "", err
	}
	return m.Slug, nil
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
