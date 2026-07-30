package testing

import (
	"context"

	"github.com/owncast/owncast-plugin-sdk/host-runtime/sqlstore"
	plugin "github.com/owncast/owncast/services/plugins"
)

// The scenario runner, the dev server, and the demo host share one SQL
// implementation (host-runtime/sqlstore), so a plugin sees the same limits and
// the same errors whichever one it runs under. See that package for what it does
// and does not reproduce from Owncast.

func (m *MockHost) sqlStore() *sqlstore.Store {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sql == nil {
		m.sql = sqlstore.NewMemory()
	}
	return m.sql
}

func (m *MockHost) sqlExec(ctx context.Context, pluginName string, req plugin.SQLRequest) plugin.SQLExecResult {
	return m.sqlStore().Exec(ctx, pluginName, req)
}

func (m *MockHost) sqlQuery(ctx context.Context, pluginName string, req plugin.SQLRequest) plugin.SQLQueryResult {
	return m.sqlStore().Query(ctx, pluginName, req)
}

// closeSQL drops every database the scenario opened.
func (m *MockHost) closeSQL() {
	m.mu.Lock()
	store := m.sql
	m.sql = nil
	m.mu.Unlock()
	if store != nil {
		store.Close()
	}
}
