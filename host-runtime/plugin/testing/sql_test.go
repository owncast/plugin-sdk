package testing

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	plugin "github.com/owncast/owncast/services/plugins"
)

func TestMockHostSQLRoundTripAndIsolation(t *testing.T) {
	mock := NewMockHost()
	defer mock.closeSQL()
	env := mock.HostEnv()
	ctx := context.Background()

	if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)"}); result.Error != "" {
		t.Fatal(result.Error)
	}
	if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: "INSERT INTO items (name) VALUES (?)", Params: []any{"one"}}); result.Error != "" || result.LastInsertID != 1 {
		t.Fatalf("insert result: %+v", result)
	}
	result := env.SQLQuery(ctx, "demo", plugin.SQLRequest{SQL: "SELECT id, name FROM items"})
	if result.Error != "" || len(result.Rows) != 1 || result.Rows[0][1] != "one" {
		t.Fatalf("query result: %+v", result)
	}
	if result := env.SQLQuery(ctx, "demo", plugin.SQLRequest{SQL: "SELECT id FROM items WHERE id = ?", Params: []any{int64(99)}}); result.Error != "" || result.Rows == nil || len(result.Rows) != 0 {
		t.Fatalf("empty query result: %+v", result)
	}
	if result := env.SQLQuery(ctx, "other", plugin.SQLRequest{SQL: "SELECT name FROM items"}); result.Error == "" || !strings.Contains(result.Error, "no such table") {
		t.Fatalf("expected each plugin to get its own database: %+v", result)
	}
}

// The limits a plugin can hit are shared with Owncast rather than reimplemented
// here, so a plugin that passes its scenarios meets the same limits in
// production. This pins the behaviours that come from plugin.SQLRunner.
func TestMockHostSQLSharesTheHostLimits(t *testing.T) {
	mock := NewMockHost()
	defer mock.closeSQL()
	env := mock.HostEnv()
	ctx := context.Background()

	// exec is one transaction: a failing statement discards the whole batch.
	if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: "CREATE TABLE items (n INTEGER); INSERT INTO items VALUES (1); INSERT INTO missing VALUES (1)"}); result.Error == "" {
		t.Fatal("expected the failing statement to roll back the batch")
	}
	if result := env.SQLQuery(ctx, "demo", plugin.SQLRequest{SQL: "SELECT count(*) FROM items"}); result.Error == "" {
		t.Fatal("expected the rolled-back table to be gone")
	}

	if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: "CREATE TABLE items (n INTEGER)"}); result.Error != "" {
		t.Fatal(result.Error)
	}
	seed := "WITH RECURSIVE c(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM c WHERE i < 10050) INSERT INTO items SELECT i FROM c"
	if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: seed}); result.Error != "" {
		t.Fatal(result.Error)
	}

	// An unbounded query that overruns the row cap is an error, not a silently
	// short result.
	unbounded := env.SQLQuery(ctx, "demo", plugin.SQLRequest{SQL: "SELECT n FROM items"})
	if unbounded.Error == "" || !strings.Contains(unbounded.Error, "add a LIMIT") {
		t.Fatalf("expected the row cap to reject an unbounded read, got %d rows and error %q", len(unbounded.Rows), unbounded.Error)
	}

	// A caller-supplied MaxRows is intent: the host stops there and says so,
	// which is how queryRow reads one row out of a large table.
	bounded := env.SQLQuery(ctx, "demo", plugin.SQLRequest{SQL: "SELECT n FROM items ORDER BY n", MaxRows: 1})
	if bounded.Error != "" || len(bounded.Rows) != 1 || !bounded.Truncated {
		t.Fatalf("expected one row and a truncation flag, got %+v", bounded)
	}

	// A single oversized value is refused rather than handed to the plugin.
	oversized := env.SQLQuery(ctx, "demo", plugin.SQLRequest{SQL: "SELECT hex(zeroblob(1048576))"})
	if oversized.Error == "" || !strings.Contains(oversized.Error, "too big") {
		t.Fatalf("expected the per-value limit to reject the blob, got %q", oversized.Error)
	}

	// Request validation is the same parser the production host uses, so a
	// scenario catches a malformed request before Owncast does.
	if _, err := plugin.ParseSQLRequest(`{"sql":"SELECT ?","params":[[1,2]]}`); err == nil {
		t.Fatal("expected a nested parameter to be rejected")
	}
	req, err := plugin.ParseSQLRequest(`{"sql":"INSERT INTO items VALUES (?)","params":[1152921504606846977]}`)
	if err != nil {
		t.Fatal(err)
	}
	if result := env.SQLExec(ctx, "demo", req); result.Error != "" {
		t.Fatal(result.Error)
	}
	stored := env.SQLQuery(ctx, "demo", plugin.SQLRequest{SQL: "SELECT typeof(n), n FROM items WHERE n > 1000000000000000000", MaxRows: 1})
	if stored.Error != "" || len(stored.Rows) != 1 {
		t.Fatalf("expected the large integer back, got %+v", stored)
	}
	if stored.Rows[0][0] != "integer" || stored.Rows[0][1] != int64(1152921504606846977) {
		t.Fatalf("large integer round-tripped as %v (%v)", stored.Rows[0][1], stored.Rows[0][0])
	}
}

// A plugin error surfaces with the same text Owncast would report, so a scenario
// that asserts on it keeps passing in production. The pure-Go driver decorates
// SQLite's message and the store strips that decoration back off.
func TestMockHostSQLErrorsReadLikeProduction(t *testing.T) {
	mock := NewMockHost()
	defer mock.closeSQL()
	env := mock.HostEnv()

	result := env.SQLQuery(context.Background(), "demo", plugin.SQLRequest{SQL: "SELECT * FROM nope"})
	if result.Error != "no such table: nope" {
		t.Fatalf("error text is %q, want the undecorated SQLite message", result.Error)
	}

	ctx := context.Background()
	schema := "CREATE TABLE parents (id INTEGER PRIMARY KEY); CREATE TABLE children (value TEXT NOT NULL UNIQUE, parent_id INTEGER REFERENCES parents(id))"
	if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: schema}); result.Error != "" {
		t.Fatal(result.Error)
	}
	if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: "INSERT INTO children VALUES ('taken', NULL)"}); result.Error != "" {
		t.Fatal(result.Error)
	}
	for statement, want := range map[string]string{
		"INSERT INTO children VALUES ('taken', NULL)": "UNIQUE constraint failed: children.value",
		"INSERT INTO children VALUES (NULL, NULL)":    "NOT NULL constraint failed: children.value",
		"INSERT INTO children VALUES ('orphan', 99)":  "FOREIGN KEY constraint failed",
	} {
		if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: statement}); result.Error != want {
			t.Errorf("%q returned %q, want %q", statement, result.Error, want)
		}
	}
}

// Every statement Owncast refuses has to be refused here too, or a plugin's
// scenario tests are worthless: an author would watch a test pass and then hit a
// failure on a real server. The refusal comes from the shared check in
// plugins.ParseSQLRequest, which runs at the host-function boundary in every
// host, because the pure-Go driver here cannot install Owncast's SQLite
// authorizer. pluginhost has the matching test against that authorizer.
func TestMockHostSQLRefusesEverythingOwncastRefuses(t *testing.T) {
	mock := NewMockHost()
	defer mock.closeSQL()
	env := mock.HostEnv()
	ctx := context.Background()

	for _, statement := range plugin.DeniedSQLStatementExamples {
		if _, err := plugin.ParseSQLRequest(sqlRequestJSON(statement)); err == nil {
			t.Errorf("the host accepted %q, which Owncast refuses", statement)
		}
	}

	// The store still runs ordinary SQL, so the check is not simply refusing
	// everything.
	if result := env.SQLExec(ctx, "demo", plugin.SQLRequest{SQL: "CREATE TABLE items (v TEXT)"}); result.Error != "" {
		t.Fatal(result.Error)
	}
}

func sqlRequestJSON(statement string) string {
	encoded, err := json.Marshal(map[string]string{"sql": statement})
	if err != nil {
		panic(err)
	}
	return string(encoded)
}
