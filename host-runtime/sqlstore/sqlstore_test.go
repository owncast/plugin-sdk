package sqlstore

import (
	"context"
	"strings"
	"testing"

	plugins "github.com/owncast/owncast/services/plugins"
)

func TestStoreMatchesProductionValueLimit(t *testing.T) {
	store := NewMemory()
	t.Cleanup(store.Close)
	ctx := context.Background()

	if result := store.Exec(ctx, "plugin", plugins.SQLRequest{SQL: "CREATE TABLE items (value BLOB)"}); result.Error != "" {
		t.Fatal(result.Error)
	}
	result := store.Exec(ctx, "plugin", plugins.SQLRequest{SQL: "INSERT INTO items VALUES (zeroblob(?))", Params: []any{int64(plugins.MaxSQLValueBytes + 1)}})
	if result.Error == "" || !strings.Contains(result.Error, "too big") {
		t.Fatalf("oversized value returned %q, want SQLite size-limit error", result.Error)
	}
}
