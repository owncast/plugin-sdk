package kv

import (
	"fmt"

	bolt "go.etcd.io/bbolt"
)

// NewBolt opens a bbolt-backed Store at the given path. This is the
// production implementation: data persists across host restarts.
func NewBolt(path string) (Store, error) {
	db, err := bolt.Open(path, 0o600, nil)
	if err != nil {
		return nil, fmt.Errorf("open bbolt at %s: %w", path, err)
	}
	return &boltStore{db: db}, nil
}

type boltStore struct {
	db *bolt.DB
}

func (s *boltStore) Close() error { return s.db.Close() }

func (s *boltStore) Namespace(plugin string) Namespace {
	return &boltNamespace{db: s.db, bucket: []byte("plugin:" + plugin)}
}

type boltNamespace struct {
	db     *bolt.DB
	bucket []byte
}

func (n *boltNamespace) Get(key string) ([]byte, error) {
	var out []byte
	err := n.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket(n.bucket)
		if b == nil {
			return nil
		}
		v := b.Get([]byte(key))
		if v != nil {
			out = append([]byte{}, v...)
		}
		return nil
	})
	return out, err
}

func (n *boltNamespace) Set(key string, value []byte) error {
	return n.db.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists(n.bucket)
		if err != nil {
			return err
		}
		return b.Put([]byte(key), value)
	})
}

func (n *boltNamespace) Delete(key string) error {
	return n.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(n.bucket)
		if b == nil {
			return nil
		}
		return b.Delete([]byte(key))
	})
}
