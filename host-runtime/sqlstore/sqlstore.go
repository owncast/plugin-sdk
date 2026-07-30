// Package sqlstore gives this repo's host binaries the per-plugin SQLite
// databases the storage.sql host functions need, so a plugin author can develop
// and test against owncast.sql without a running Owncast. The scenario test
// runner, the localhost dev server, and the demo binary all wire the same store.
//
// It is deliberately not part of Owncast. Owncast uses the cgo
// mattn/go-sqlite3 driver, the same one its own datastore uses, and configures
// each connection with a SQLite authorizer. This package uses
// modernc.org/sqlite instead, because owncast-plugin-test and
// owncast-plugin-serve are cross-compiled for every release target with
// CGO_ENABLED=0 and a cgo driver cannot go in them.
//
// A different driver would normally mean a plugin could pass its scenario tests
// and still fail on a real server, which would make those tests worthless. The
// pieces that decide whether a statement is allowed, and what it costs,
// therefore live above the driver in the runtime both hosts share:
// plugins.SQLRunner applies the same request validation, parameter typing, call
// timeout, atomic-exec semantics, and row, value, and result limits, and
// plugins.DeniedSQLReason refuses the same statements Owncast's authorizer
// refuses. plugins.DeniedSQLStatementExamples is the fixture both repositories
// test against. The DSN below pins the same page size and database size cap.
//
// What the driver still owns is the last line of defence rather than the
// contract. Owncast's authorizer sees compiled statements, so it stays
// authoritative there, and nothing in this package is a security boundary.
package sqlstore

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sync"

	plugins "github.com/owncast/owncast/services/plugins"
	sqlite "modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

const (
	driverName = "sqlite"
	pageSize   = 4096
	// maxBytes mirrors pluginhost's per-plugin database cap, so a plugin that
	// outgrows its storage in development outgrows it in production too.
	maxBytes = 128 << 20
)

// memoryDSN configures a private in-memory database like a production one.
// In-memory keeps a dev host stateless the way its key-value store already is,
// and keeps scenario runs hermetic.
var memoryDSN = fmt.Sprintf(
	":memory:?_pragma=page_size(%d)&_pragma=max_page_count(%d)&_pragma=foreign_keys(on)&_pragma=trusted_schema(off)&_pragma=temp_store(memory)",
	pageSize,
	maxBytes/pageSize,
)

// driverNoise matches the decoration modernc.org/sqlite adds to SQLite's own
// messages ("SQL logic error: no such table: t (1)" or "string or blob too big
// (18)"). Stripping it leaves the message Owncast's driver reports, so a
// scenario asserting on an error sees the production text.
var driverNoise = regexp.MustCompile(`^(?:(?:SQL logic error|constraint failed): )?(.*) \(\d+\)$`)

// Store holds one in-memory database per plugin. Plugins cannot see each
// other's tables, as in production.
type Store struct {
	mu  sync.Mutex
	dbs map[string]*sql.DB
}

// NewMemory returns a store whose databases live only as long as it does.
func NewMemory() *Store {
	return &Store{dbs: make(map[string]*sql.DB)}
}

// Exec runs one statement batch for a plugin as a single transaction.
func (s *Store) Exec(ctx context.Context, pluginName string, req plugins.SQLRequest) plugins.SQLExecResult {
	runner, err := s.runner(pluginName)
	if err != nil {
		return plugins.SQLExecResult{Error: err.Error()}
	}
	result := runner.Exec(ctx, req)
	result.Error = normalizeError(result.Error)
	return result
}

// Query runs one query for a plugin and returns a bounded result set.
func (s *Store) Query(ctx context.Context, pluginName string, req plugins.SQLRequest) plugins.SQLQueryResult {
	runner, err := s.runner(pluginName)
	if err != nil {
		return plugins.SQLQueryResult{Error: err.Error()}
	}
	result := runner.Query(ctx, req)
	result.Error = normalizeError(result.Error)
	return result
}

// Close drops every database the store opened.
func (s *Store) Close() {
	s.mu.Lock()
	dbs := s.dbs
	s.dbs = nil
	s.mu.Unlock()
	for _, db := range dbs {
		_ = db.Close()
	}
}

func (s *Store) runner(pluginName string) (plugins.SQLRunner, error) {
	db, err := s.database(pluginName)
	if err != nil {
		return plugins.SQLRunner{}, err
	}
	return plugins.SQLRunner{DB: db}, nil
}

func (s *Store) database(pluginName string) (*sql.DB, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dbs == nil {
		s.dbs = make(map[string]*sql.DB)
	}
	if db := s.dbs[pluginName]; db != nil {
		return db, nil
	}
	db, err := sql.Open(driverName, memoryDSN)
	if err != nil {
		return nil, err
	}
	// One connection, matching production: statements serialize instead of
	// contending, and an in-memory database exists only while a connection to
	// it does.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	conn, err := db.Conn(context.Background())
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := sqlite.Limit(conn, sqlite3.SQLITE_LIMIT_LENGTH, plugins.MaxSQLValueBytes); err != nil {
		_ = conn.Close()
		_ = db.Close()
		return nil, err
	}
	_ = conn.Close()
	s.dbs[pluginName] = db
	return db, nil
}

func normalizeError(message string) string {
	if match := driverNoise.FindStringSubmatch(message); match != nil {
		return match[1]
	}
	return message
}
