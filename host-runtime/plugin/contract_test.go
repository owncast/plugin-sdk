package plugin

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// hostFnNameRe matches an actual host-function name exactly, not the error
// strings ("owncast_x from %s: ...") that also begin with the prefix.
var hostFnNameRe = regexp.MustCompile(`^owncast_[a-z_]+$`)

// The plugin wire contract, the host-function names, permission identifiers,
// and serialized wire-type field shapes that plugins (and the TypeScript SDK,
// and Owncast's embedded copy of this runtime) depend on. It's extracted from
// hostfns.go and pinned to a committed golden file (plugin-contract.json).
//
// Two things drift silently without a guard:
//  1. The TS SDK / build CLI stop matching the Go host functions.
//  2. Owncast's vendored copy of this runtime (services/plugins) falls behind
//     this one, exactly what happened with the videoconfig host functions.
//
// (1) is caught here (host-fn coverage in index.js) plus sdk_drift_test.go.
// (2) is caught in the *consumer* repo: it runs the same extractor against its
// own hostfns.go and compares to its vendored copy of plugin-contract.json.
//
// Regenerate the golden after an intentional contract change:
//
//	UPDATE_CONTRACT=1 go test ./plugin/ -run TestPluginContract
//
// then copy host-runtime/plugin/plugin-contract.json into any consumer repo
// (e.g. owncast/services/plugins/plugin-contract.json), whose own contract
// test will then force its runtime copy to match.

// contract is the canonical, package-agnostic description of the wire surface.
type contract struct {
	Permissions   map[string]string            `json:"permissions"`
	HostFunctions []string                     `json:"hostFunctions"`
	WireTypes     map[string]map[string]string `json:"wireTypes"`
}

// buildContractFromSource extracts the wire contract from hostfns.go source.
// Intentionally identical across the SDK and every consumer repo so the
// artifacts it produces are comparable byte-for-byte. Keep it in sync if you
// change it (it's small and stable on purpose).
func buildContractFromSource(t *testing.T, src string) contract {
	t.Helper()
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "hostfns.go", src, 0)
	if err != nil {
		t.Fatalf("parse hostfns.go: %v", err)
	}

	c := contract{
		Permissions: map[string]string{},
		WireTypes:   map[string]map[string]string{},
	}

	fnSet := map[string]bool{}
	ast.Inspect(f, func(n ast.Node) bool {
		lit, ok := n.(*ast.BasicLit)
		if ok && lit.Kind == token.STRING {
			if s, err := strconv.Unquote(lit.Value); err == nil && hostFnNameRe.MatchString(s) {
				fnSet[s] = true
			}
		}
		return true
	})
	for name := range fnSet {
		c.HostFunctions = append(c.HostFunctions, name)
	}
	sort.Strings(c.HostFunctions)

	for _, decl := range f.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		switch gd.Tok {
		case token.CONST:
			for _, spec := range gd.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok {
					continue
				}
				for i, name := range vs.Names {
					if !strings.HasPrefix(name.Name, "Perm") || i >= len(vs.Values) {
						continue
					}
					if lit, ok := vs.Values[i].(*ast.BasicLit); ok && lit.Kind == token.STRING {
						if v, err := strconv.Unquote(lit.Value); err == nil {
							c.Permissions[name.Name] = v
						}
					}
				}
			}
		case token.TYPE:
			for _, spec := range gd.Specs {
				ts, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				st, ok := ts.Type.(*ast.StructType)
				if !ok {
					continue
				}
				fields := map[string]string{}
				for _, field := range st.Fields.List {
					tag := jsonTagName(field.Tag)
					if tag == "" || tag == "-" {
						continue
					}
					fields[tag] = exprTypeString(field.Type)
				}
				// Only structs with JSON tags cross the wire to plugins.
				if len(fields) > 0 {
					c.WireTypes[ts.Name.Name] = fields
				}
			}
		}
	}
	return c
}

// jsonTagName returns the JSON field name from a struct tag, or "" if absent.
func jsonTagName(tag *ast.BasicLit) string {
	if tag == nil {
		return ""
	}
	raw, err := strconv.Unquote(tag.Value)
	if err != nil {
		return ""
	}
	for _, part := range strings.Fields(raw) {
		if strings.HasPrefix(part, "json:") {
			v, err := strconv.Unquote(strings.TrimPrefix(part, "json:"))
			if err != nil {
				return ""
			}
			return strings.Split(v, ",")[0]
		}
	}
	return ""
}

// exprTypeString renders a type expression to a stable string (e.g. "int",
// "*int", "[]StreamVariant", "map[string]bool").
func exprTypeString(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + exprTypeString(t.X)
	case *ast.ArrayType:
		return "[]" + exprTypeString(t.Elt)
	case *ast.SelectorExpr:
		return exprTypeString(t.X) + "." + t.Sel.Name
	case *ast.MapType:
		return "map[" + exprTypeString(t.Key) + "]" + exprTypeString(t.Value)
	default:
		return "?"
	}
}

func marshalContract(t *testing.T, c contract) []byte {
	t.Helper()
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		t.Fatalf("marshal contract: %v", err)
	}
	return append(data, '\n')
}

// repoFilePath resolves a path relative to the repo root (same anchoring as
// readRepoFile in sdk_drift_test.go).
func repoFilePath(relPath string) string {
	_, thisFile, _, _ := runtime.Caller(0)
	repoRoot := filepath.Join(filepath.Dir(thisFile), "..", "..")
	return filepath.Join(repoRoot, relPath)
}

const contractGoldenPath = "host-runtime/plugin/plugin-contract.json"

func TestPluginContract(t *testing.T) {
	got := buildContractFromSource(t, readRepoFile(t, "host-runtime/plugin/hostfns.go"))
	gotJSON := marshalContract(t, got)

	goldenAbs := repoFilePath(contractGoldenPath)
	if os.Getenv("UPDATE_CONTRACT") == "1" {
		if err := os.WriteFile(goldenAbs, gotJSON, 0o644); err != nil { //nolint:gosec // human-readable golden, not a secret
			t.Fatalf("write golden: %v", err)
		}
		t.Logf("updated %s", contractGoldenPath)
		return
	}

	want, err := os.ReadFile(goldenAbs)
	if err != nil {
		t.Fatalf("Missing the plugin API snapshot %s.\n"+
			"Create it with:  UPDATE_CONTRACT=1 go test ./plugin/ -run TestPluginContract", contractGoldenPath)
	}
	if string(gotJSON) != string(want) {
		t.Errorf(`The plugin API changed.

The host functions, permissions, or data shapes a plugin can use (defined in
hostfns.go) no longer match the saved snapshot in %s.

• If you meant to change the plugin API, update the snapshot:
    UPDATE_CONTRACT=1 go test ./plugin/ -run TestPluginContract
  then copy host-runtime/plugin/plugin-contract.json into every app that
  bundles this runtime (e.g. Owncast's services/plugins/) so plugins keep
  working everywhere.

• If you did not mean to change it, undo your edit to hostfns.go.`, contractGoldenPath)
	}

	// Every host function needs a JS wrapper or plugin authors can't call it.
	// (The build CLI's import list is checked by sdk_drift_test.go.)
	indexJS := readRepoFile(t, "sdks/js/index.js")
	for _, fn := range got.HostFunctions {
		if !strings.Contains(indexJS, fn) {
			t.Errorf("Host function %q has no wrapper in sdks/js/index.js, so plugin\n"+
				"authors can't call it. Add a wrapper there (and a type in index.d.ts).", fn)
		}
	}
}
