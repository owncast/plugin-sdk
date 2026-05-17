package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
)

const SupportedAPIVersion = "1"

type Subscription struct {
	Event    string `json:"event"`
	Priority int    `json:"priority,omitempty"`
}

type Subscriptions struct {
	Notify []Subscription `json:"notify,omitempty"`
	Filter []Subscription `json:"filter,omitempty"`
}

type ConfigField struct {
	Type        string `json:"type"`
	Default     any    `json:"default,omitempty"`
	Description string `json:"description,omitempty"`
}

type Manifest struct {
	API           string                 `json:"api"`
	Name          string                 `json:"name"`
	Version       string                 `json:"version"`
	Description   string                 `json:"description,omitempty"`
	Subscriptions Subscriptions          `json:"subscriptions"`
	Permissions   []string               `json:"permissions,omitempty"`
	Config        map[string]ConfigField `json:"config,omitempty"`
	Admin         AdminConfig            `json:"admin,omitempty"`
}

// AdminConfig declares admin-only surfaces a plugin exposes. The Owncast
// admin web UI lists these in the "Plugins" section; each page renders the
// plugin's content at /plugins/<name>/<path>. Paths declared here are
// auth-gated by the host — unauthenticated requests get 401 before
// reaching the plugin.
type AdminConfig struct {
	Pages []AdminPage `json:"pages,omitempty"`
}

type AdminPage struct {
	Title string `json:"title"`
	// Path is a glob (e.g. "/admin", "/admin/*"). Requests under
	// /plugins/<name>/<rest> are checked against each glob and require
	// admin authentication when any match.
	Path string `json:"path"`
	Icon string `json:"icon,omitempty"`
}


func ParseManifest(b []byte) (*Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("parse manifest json: %w", err)
	}
	if err := m.Validate(); err != nil {
		return nil, err
	}
	return &m, nil
}

func (m *Manifest) Validate() error {
	if m.API != SupportedAPIVersion {
		return fmt.Errorf("unsupported api version %q (host supports %q)", m.API, SupportedAPIVersion)
	}
	if m.Name == "" {
		return errors.New("manifest.name is required")
	}
	if m.Version == "" {
		return errors.New("manifest.version is required")
	}
	for i, page := range m.Admin.Pages {
		if page.Title == "" {
			return fmt.Errorf("manifest.admin.pages[%d].title is required", i)
		}
		if page.Path == "" {
			return fmt.Errorf("manifest.admin.pages[%d].path is required", i)
		}
	}
	return nil
}


// AgreesWith reports whether the runtime registration `other` is consistent
// with the sidecar manifest. The sidecar declares identity and permissions;
// the runtime must not exceed declared permissions. Subscriptions are derived
// by the SDK at runtime, so they aren't validated here.
func (m *Manifest) AgreesWith(other *Manifest) error {
	if m.Name != other.Name {
		return fmt.Errorf("name mismatch: manifest=%q register=%q", m.Name, other.Name)
	}
	if m.Version != other.Version {
		return fmt.Errorf("version mismatch: manifest=%q register=%q", m.Version, other.Version)
	}
	declared := stringSet(m.Permissions)
	for _, p := range other.Permissions {
		if !declared[p] {
			return fmt.Errorf("plugin requested permission %q at runtime not declared in manifest", p)
		}
	}
	return nil
}

func stringSet(items []string) map[string]bool {
	out := make(map[string]bool, len(items))
	for _, i := range items {
		out[i] = true
	}
	return out
}
