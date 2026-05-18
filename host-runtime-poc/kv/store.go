// Package kv is a namespaced key/value store. Each plugin gets its own
// namespace so plugins cannot read or overwrite each other's keys.
//
// Two implementations: NewBolt for production (file-backed via bbolt) and
// NewMemory for tests (in-memory, hermetic per scenario).
package kv

type Store interface {
	// Namespace returns a handle scoped to a single plugin name. Calls on the
	// returned handle only see keys within that plugin's namespace.
	Namespace(plugin string) Namespace
	Close() error
}

type Namespace interface {
	Get(key string) ([]byte, error)
	Set(key string, value []byte) error
	Delete(key string) error
}
