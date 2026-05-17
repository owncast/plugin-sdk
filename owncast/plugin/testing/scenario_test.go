package testing

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeScenarios(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "x.test.json")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadScenarios_Valid(t *testing.T) {
	path := writeScenarios(t, `[
		{
			"name": "first",
			"events": [
				{"event": "chat.message.received", "payload": {"user": "alice", "body": "hi"}}
			]
		},
		{
			"name": "second",
			"events": [
				{"filter": "chat.message.received", "payload": {"user": "alice", "body": "hi"},
				 "expect": {"action": "pass"}}
			]
		}
	]`)
	scenarios, err := LoadScenarios(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(scenarios) != 2 {
		t.Fatalf("got %d scenarios, want 2", len(scenarios))
	}
	if scenarios[0].Name != "first" || scenarios[1].Name != "second" {
		t.Errorf("scenario names wrong: %q, %q", scenarios[0].Name, scenarios[1].Name)
	}
}

func TestLoadScenarios_RejectsMalformedJSON(t *testing.T) {
	path := writeScenarios(t, `[{not valid json`)
	if _, err := LoadScenarios(path); err == nil {
		t.Fatal("expected error for malformed JSON, got nil")
	}
}

func TestLoadScenarios_RequiresScenarioName(t *testing.T) {
	path := writeScenarios(t, `[
		{"events": [{"event": "x", "payload": null}]}
	]`)
	if _, err := LoadScenarios(path); err == nil {
		t.Fatal("expected error for scenario without name")
	} else if !strings.Contains(err.Error(), "name") {
		t.Errorf("error mentions name: got %v", err)
	}
}

func TestLoadScenarios_RejectsAmbiguousStep(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    string
	}{
		{
			name: "both event and filter",
			content: `[{"name": "x", "events": [
				{"event": "a", "filter": "b", "payload": {}}
			]}]`,
			want: "exactly one of",
		},
		{
			name: "neither event nor filter nor http",
			content: `[{"name": "x", "events": [
				{"payload": {}}
			]}]`,
			want: "exactly one of",
		},
		{
			name: "filter expect on event step",
			content: `[{"name": "x", "events": [
				{"event": "a", "payload": {}, "expect": {"action": "pass"}}
			]}]`,
			want: "filter steps",
		},
		{
			name: "http step without path",
			content: `[{"name": "x", "events": [
				{"http": {"method": "GET"}}
			]}]`,
			want: "path",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := writeScenarios(t, tc.content)
			_, err := LoadScenarios(path)
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error: got %q, want substring %q", err.Error(), tc.want)
			}
		})
	}
}

func TestLoadScenarios_MissingFile(t *testing.T) {
	if _, err := LoadScenarios("/nonexistent/path.json"); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoadScenarios_HTTPStepValid(t *testing.T) {
	path := writeScenarios(t, `[
		{
			"name": "http test",
			"events": [
				{
					"http": {
						"method": "GET",
						"path": "/api/foo",
						"headers": {"X-Test": "1"},
						"expect": {"status": 200, "body": "ok"}
					}
				}
			]
		}
	]`)
	scenarios, err := LoadScenarios(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(scenarios) != 1 {
		t.Fatalf("got %d scenarios, want 1", len(scenarios))
	}
	step := scenarios[0].Steps[0]
	if step.HTTP == nil {
		t.Fatal("HTTP step lost during decode")
	}
	if step.HTTP.Method != "GET" || step.HTTP.Path != "/api/foo" {
		t.Errorf("http fields: %+v", step.HTTP)
	}
	if step.HTTP.Expect == nil || step.HTTP.Expect.Status != 200 {
		t.Errorf("http expect: %+v", step.HTTP.Expect)
	}
}

func TestLoadScenarios_FilterExpectShapes(t *testing.T) {
	path := writeScenarios(t, `[
		{
			"name": "modify with payload",
			"events": [
				{
					"filter": "chat.message.received",
					"payload": {"body": "hi"},
					"expect": {"action": "modify", "payload": {"body": "redacted"}}
				}
			]
		},
		{
			"name": "drop with reason",
			"events": [
				{
					"filter": "chat.message.received",
					"payload": {"body": "spam"},
					"expect": {"action": "drop", "reason": "blocked"}
				}
			]
		}
	]`)
	scenarios, err := LoadScenarios(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if scenarios[0].Steps[0].Expect.Action != "modify" {
		t.Errorf("got action %q", scenarios[0].Steps[0].Expect.Action)
	}
	if scenarios[1].Steps[0].Expect.Reason != "blocked" {
		t.Errorf("got reason %q", scenarios[1].Steps[0].Expect.Reason)
	}
}
