package main

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/extism/go-sdk"
	plugins "github.com/owncast/owncast/services/plugins"
)

type stackSignature struct {
	params  []string
	results []string
}

func TestSharedEngineHostFunctionContracts(t *testing.T) {
	expected := hostFunctionContract(t)
	root := repositoryRoot(t)

	for name, path := range map[string]string{
		"JavaScript": filepath.Join(root, "engines", "javascript", "engine.d.ts"),
		"Python":     filepath.Join(root, "engines", "build_py.py"),
	} {
		t.Run(name, func(t *testing.T) {
			actual := parseEngineContract(t, name, path)
			if diff := contractDiff(expected, actual); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func hostFunctionContract(t *testing.T) map[string]stackSignature {
	t.Helper()
	contract := map[string]stackSignature{}
	for _, fn := range plugins.BuildHostFunctions(&plugins.HostEnv{}) {
		if _, exists := contract[fn.Name]; exists {
			t.Fatalf("duplicate Owncast host function %q", fn.Name)
		}
		contract[fn.Name] = stackSignature{
			params:  stackTypes(t, fn.Params),
			results: stackTypes(t, fn.Returns),
		}
	}
	return contract
}

func stackTypes(t *testing.T, values []extism.ValueType) []string {
	t.Helper()
	out := make([]string, len(values))
	for i, value := range values {
		switch value {
		case extism.ValueTypeI64:
			// Extism PTR is an alias for WebAssembly i64, so the stack ABI cannot
			// distinguish the semantic labels used in the engine declarations.
			out[i] = "i64"
		case extism.ValueTypeI32:
			out[i] = "i32"
		case extism.ValueTypeF32:
			out[i] = "f32"
		case extism.ValueTypeF64:
			out[i] = "f64"
		default:
			t.Fatalf("unknown Extism value type %d", value)
		}
	}
	return out
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate contract test")
	}
	return filepath.Dir(filepath.Dir(file))
}

var (
	javascriptImport = regexp.MustCompile(`(?m)^\s+(owncast_[a-z_]+)\(([^)]*)\):\s*(PTR|I64|I32|F32|F64|void);$`)
	pythonImport     = regexp.MustCompile(`(?m)^\s+\("(owncast_[a-z_]+)",\s*"([^"]*)"(?:,\s*"([^"]*)")?\),$`)
)

func parseEngineContract(t *testing.T, engine, path string) map[string]stackSignature {
	t.Helper()
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	contract := map[string]stackSignature{}
	pattern := pythonImport
	if engine == "JavaScript" {
		pattern = javascriptImport
	}
	for _, match := range pattern.FindAllSubmatch(source, -1) {
		name := string(match[1])
		if _, exists := contract[name]; exists {
			t.Fatalf("duplicate %s host import %q", engine, name)
		}
		contract[name] = stackSignature{
			params:  declarationTypes(t, string(match[2])),
			results: declarationResult(t, string(match[3])),
		}
	}
	return contract
}

func declarationTypes(t *testing.T, parameters string) []string {
	t.Helper()
	if strings.TrimSpace(parameters) == "" {
		return nil
	}
	parts := strings.Split(parameters, ",")
	out := make([]string, 0, len(parts))
	for _, parameter := range parts {
		_, annotation, ok := strings.Cut(parameter, ":")
		if !ok {
			t.Fatalf("host import parameter %q has no type", parameter)
		}
		out = append(out, declarationType(t, strings.TrimSpace(annotation)))
	}
	return out
}

func declarationResult(t *testing.T, result string) []string {
	t.Helper()
	if result == "" || result == "void" {
		return nil
	}
	return []string{declarationType(t, result)}
}

func declarationType(t *testing.T, value string) string {
	t.Helper()
	switch value {
	case "PTR", "I64", "int", "str", "bytes":
		return "i64"
	case "I32":
		return "i32"
	case "F32":
		return "f32"
	case "F64":
		return "f64"
	default:
		t.Fatalf("unknown engine declaration type %q", value)
		return ""
	}
}

func contractDiff(expected, actual map[string]stackSignature) string {
	var differences []string
	for name, want := range expected {
		got, ok := actual[name]
		if !ok {
			differences = append(differences, "missing "+name)
			continue
		}
		if strings.Join(want.params, ",") != strings.Join(got.params, ",") || strings.Join(want.results, ",") != strings.Join(got.results, ",") {
			differences = append(differences, name+" stack signature differs")
		}
	}
	for name := range actual {
		if _, ok := expected[name]; !ok {
			differences = append(differences, "unexpected "+name)
		}
	}
	sort.Strings(differences)
	return strings.Join(differences, "\n")
}
