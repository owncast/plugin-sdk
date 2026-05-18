# safeguard-stress

Misbehaves on demand: spin in tight loops, return huge outputs, try to allocate past the wasm memory cap. The Go-side safeguard tests (`host-runtime-poc/plugin/safeguards_test.go`) drive these branches to verify the host's per-call timeouts, output-size caps, and wasm memory limit actually kick in.

**Demonstrates:** nothing useful for a real plugin — this is a test fixture for the host's sandbox enforcement. Useful to read if you want to understand what the host protects against.
