import assert from "node:assert/strict";

import {
  groupTraceEvents,
  summarizeTraceEvents,
} from "../lib/traceTimeline.mjs";

const events = [
  { id: "end", sequence: 8, type: "run.failed", status: "FAILED", metadata: {} },
  { id: "start", sequence: 1, type: "run.started", status: "RUNNING", metadata: {} },
  { id: "llm-start", sequence: 2, type: "llm.started", model: "model-a", metadata: {} },
  { id: "llm-done", sequence: 3, type: "llm.completed", model: "model-a", metadata: { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } },
  { id: "choice", sequence: 4, type: "message.completed", metadata: { tool_calls: 1 } },
  { id: "tool", sequence: 5, type: "tool.completed", metadata: {} },
  { id: "verify", sequence: 6, type: "llm.started", model: "model-b", metadata: {} },
  { id: "unknown", sequence: 7, type: "future.event", metadata: {} },
];
const originalOrder = events.map((event) => event.id);
const groups = groupTraceEvents(events);

assert.deepEqual(events.map((event) => event.id), originalOrder);
assert.deepEqual(
  groups.map((group) => group.phase),
  ["init", "model", "choice", "tool", "verify", "other", "end"],
);
assert.equal(groups.at(-1).failed, true);
assert.equal(groups.find((group) => group.phase === "other").events[0].id, "unknown");

const summary = summarizeTraceEvents(events);
assert.deepEqual(summary.models, ["model-a", "model-b"]);
assert.deepEqual(summary.usage, {
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
});

console.log("Trace timeline verification passed.");
