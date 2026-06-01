package testing

import "testing"

// TestSSESendCaptureAndAssert verifies the harness records owncast.sse.send
// calls (via the HostEnv.OnSSESend hook) and that expect.sseSends matches them
// in order, with empty Event/Data fields skipping that part of the match.
func TestSSESendCaptureAndAssert(t *testing.T) {
	mock := NewMockHost()
	env := mock.HostEnv()
	if env.OnSSESend == nil {
		t.Fatal("HostEnv.OnSSESend not wired by the mock host")
	}

	// Simulate what hostSSESend does when a plugin calls owncast.sse.send.
	env.OnSSESend("demo", "overlay", "chat", []byte(`{"body":"hi"}`))
	env.OnSSESend("demo", "overlay", "poll", []byte(`{"q":"a?"}`))

	got := mock.SSESends()
	if len(got) != 2 {
		t.Fatalf("captured %d sse sends, want 2", len(got))
	}

	// A matching expectation passes; Data omitted on the second entry to prove
	// partial matching.
	pass := &Result{}
	checkExpectations(pass, &ScenarioExpect{SSESends: []ScenarioSSEExpect{
		{Channel: "overlay", Event: "chat", Data: `{"body":"hi"}`},
		{Channel: "overlay", Event: "poll"},
	}}, mock, "demo")
	if len(pass.Errors) != 0 {
		t.Errorf("expected no errors, got %v", pass.Errors)
	}

	// A wrong event is reported.
	fail := &Result{}
	checkExpectations(fail, &ScenarioExpect{SSESends: []ScenarioSSEExpect{
		{Channel: "overlay", Event: "chat"},
		{Channel: "overlay", Event: "WRONG"},
	}}, mock, "demo")
	if len(fail.Errors) == 0 {
		t.Error("expected a mismatch error for the wrong event, got none")
	}
}
