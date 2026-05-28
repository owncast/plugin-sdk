// Scenario tests for this plugin. Each scenario dispatches an event sequence
// against the real plugin runtime (with a mocked host) and asserts on the
// side effects it observed: chatSends, kv writes, emitted events, HTTP
// requests the plugin made, etc.
//
// Runs via `npm test` (which builds the wasm first, then runs this file).
const { runScenarios } = require("@owncast/plugin-sdk/testing");

// Small helper so each scenario doesn't repeat the event shape. You can build
// scenarios any way you like in JS, loops, fixtures, computed payloads.
const incomingChat = (user, body) => ({
  event: "chat.message.received",
  payload: { id: "1", user, body, timestamp: "2024-01-01T00:00:00Z" },
});

runScenarios([
  {
    name: "greets users whose message starts with hi",
    events: [incomingChat("alice", "hi everyone")],
    expect: { chatSends: ["hello, alice!"] },
  },
  {
    name: "leaves other messages alone",
    events: [incomingChat("bob", "good morning")],
    expect: { chatSends: [] },
  },
]);
