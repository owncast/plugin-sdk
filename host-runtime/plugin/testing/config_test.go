package testing

import "testing"

// TestMockHost_ConfigValue verifies the mock serves given.config overrides
// through HostEnv.ConfigValue with the same semantics as the production host:
// (value, true) for a seeded key, (nil, false) otherwise, so owncast.config.get
// falls back to the manifest-declared default.
func TestMockHost_ConfigValue(t *testing.T) {
	mock := NewMockHost()
	env := mock.HostEnv()
	if env.ConfigValue == nil {
		t.Fatal("HostEnv.ConfigValue not wired by the mock host")
	}

	// Unseeded map: defaults-only, like a host where no admin edited settings.
	if v, ok := env.ConfigValue("any-plugin", "token"); ok || v != nil {
		t.Fatalf("unseeded ConfigValue = (%v, %v), want (nil, false)", v, ok)
	}

	mock.SetConfig(map[string]any{"token": "tok-123", "cooldownMs": float64(500)})
	if v, ok := env.ConfigValue("any-plugin", "token"); !ok || v != "tok-123" {
		t.Fatalf(`ConfigValue("token") = (%v, %v), want ("tok-123", true)`, v, ok)
	}
	if v, ok := env.ConfigValue("any-plugin", "cooldownMs"); !ok || v != float64(500) {
		t.Fatalf(`ConfigValue("cooldownMs") = (%v, %v), want (500, true)`, v, ok)
	}
	if v, ok := env.ConfigValue("any-plugin", "missing"); ok || v != nil {
		t.Fatalf("missing key = (%v, %v), want (nil, false)", v, ok)
	}
}

// TestLoadScenarios_GivenConfig verifies given.config parses into
// ScenarioGiven.Config (JSON numbers arrive as float64, which is what the
// engine hands to owncast.config.get for number-typed keys).
func TestLoadScenarios_GivenConfig(t *testing.T) {
	path := writeScenarios(t, `[
		{
			"name": "with config overrides",
			"given": { "config": { "verificationToken": "tok-123", "minAmountCents": 0 } },
			"events": [ { "event": "x", "payload": null } ]
		}
	]`)
	scs, err := LoadScenarios(path)
	if err != nil {
		t.Fatalf("LoadScenarios: %v", err)
	}
	cfg := scs[0].Given.Config
	if cfg["verificationToken"] != "tok-123" {
		t.Fatalf("verificationToken = %v, want tok-123", cfg["verificationToken"])
	}
	if cfg["minAmountCents"] != float64(0) {
		t.Fatalf("minAmountCents = %v (%T), want float64(0)", cfg["minAmountCents"], cfg["minAmountCents"])
	}
}
