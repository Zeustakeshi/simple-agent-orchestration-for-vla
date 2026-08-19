import assert from "node:assert/strict";

import {
  safeTraceError,
  safeTraceJson,
  sanitizeTraceText,
} from "../lib/tracePrivacy.mjs";
import {
  groupTraceEvents,
  summarizeTraceEvents,
} from "../lib/traceTimeline.mjs";

const SECRET_MARKERS = [
  "SECRET_PROMPT",
  "SECRET_REASONING",
  "SECRET_AUTH",
  "SECRET_TOKEN",
  "SECRET_CONTENT",
  "SECRET_LLM_MESSAGE",
  "SECRET_INLINE",
];

function assertNoSecrets(label, value) {
  const text = String(value);
  for (const marker of SECRET_MARKERS) {
    assert.ok(!text.includes(marker), `${label} leaked ${marker}`);
  }
}

const run = {
  id: "run_abc",
  trace_id: "trace_abc",
  robot_id: "robot_token=SECRET_INLINE",
  session_id: "session_abc",
  source: "CHAT",
  status: "FAILED",
  input_text: "move arm; Authorization: Bearer SECRET_AUTH",
  created_at: "2026-08-13T00:00:00.000Z",
  completed_at: "2026-08-13T00:00:01.000Z",
  duration_ms: 1000,
  final_response: "token=SECRET_TOKEN final response",
  outcome: "failed after sanitized tool error",
  error: {
    code: "TOOL_500",
    message: "api_key=SECRET_INLINE failed",
  },
  events_dropped: 0,
};

const events = [
  {
    id: "end",
    run_id: run.id,
    trace_id: run.trace_id,
    sequence: 7,
    timestamp: run.completed_at,
    type: "run.failed",
    status: "FAILED",
    duration_ms: 1000,
    model: null,
    tool_name: null,
    arguments: null,
    result_summary: null,
    error: run.error,
    metadata: {},
  },
  {
    id: "start",
    run_id: run.id,
    trace_id: run.trace_id,
    sequence: 1,
    timestamp: run.created_at,
    type: "run.started",
    status: "RUNNING",
    duration_ms: null,
    model: null,
    tool_name: null,
    arguments: null,
    result_summary: null,
    error: null,
    metadata: {
      prompt: "SECRET_PROMPT",
      safe: "VISIBLE_INIT",
    },
  },
  {
    id: "llm",
    run_id: run.id,
    trace_id: run.trace_id,
    sequence: 2,
    timestamp: run.created_at,
    type: "llm.completed",
    status: "COMPLETED",
    duration_ms: 120,
    model: "gemini-pro",
    tool_name: null,
    arguments: null,
    result_summary: {
      usage: {
        prompt_tokens: 10,
        completion_tokens: 6,
        total_tokens: 16,
      },
    },
    error: {
      code: "LLM_RAW",
      message: "SECRET_LLM_MESSAGE",
    },
    metadata: {
      provider: "google",
      reasoning_content: "SECRET_REASONING",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 6,
        total_tokens: 16,
      },
    },
  },
  {
    id: "choice",
    run_id: run.id,
    trace_id: run.trace_id,
    sequence: 3,
    timestamp: run.created_at,
    type: "message.completed",
    status: "COMPLETED",
    duration_ms: 30,
    model: null,
    tool_name: null,
    arguments: null,
    result_summary: null,
    error: null,
    metadata: {
      tool_calls: 1,
      messages: [{ content: "SECRET_CONTENT" }],
    },
  },
  {
    id: "tool",
    run_id: run.id,
    trace_id: run.trace_id,
    sequence: 4,
    timestamp: run.created_at,
    type: "tool.failed",
    status: "FAILED",
    duration_ms: 220,
    model: null,
    tool_name: "move_arm",
    arguments: {
      x: 1,
      authorization: "SECRET_AUTH",
    },
    result_summary: {
      safe: "VISIBLE_RESULT",
      token: "SECRET_TOKEN",
    },
    error: run.error,
    metadata: {},
  },
  {
    id: "verify",
    run_id: run.id,
    trace_id: run.trace_id,
    sequence: 5,
    timestamp: run.created_at,
    type: "llm.started",
    status: "RUNNING",
    duration_ms: null,
    model: "gemini-pro",
    tool_name: null,
    arguments: null,
    result_summary: null,
    error: null,
    metadata: {},
  },
  {
    id: "unknown",
    run_id: run.id,
    trace_id: run.trace_id,
    sequence: 6,
    timestamp: run.created_at,
    type: "future.raw_event",
    status: "COMPLETED",
    duration_ms: 1,
    model: null,
    tool_name: null,
    arguments: null,
    result_summary: {
      content: "SECRET_CONTENT",
    },
    error: null,
    metadata: {
      safe: "VISIBLE_UNKNOWN",
      scratchpad: "SECRET_REASONING",
    },
  },
];

const originalOrder = events.map((event) => event.id);
const groups = groupTraceEvents(events);

assert.deepEqual(events.map((event) => event.id), originalOrder, "timeline grouping mutated API events");
assert.deepEqual(
  groups.map((group) => group.phase),
  ["init", "model", "choice", "tool", "verify", "other", "end"],
);
assert.ok(groups.some((group) => group.failed && group.events.some((event) => event.type === "tool.failed")));
assert.ok(groups.at(-1).failed, "terminal failed run must keep the final group highlighted");

const summary = summarizeTraceEvents(events);
assert.deepEqual(summary.models, ["gemini-pro"]);
assert.deepEqual(summary.usage, {
  promptTokens: 10,
  completionTokens: 6,
  totalTokens: 16,
});

const listLikeDom = [
  sanitizeTraceText(run.input_text),
  sanitizeTraceText(run.robot_id),
].join("\n");
assertNoSecrets("runs list", listLikeDom);

const detailLikeDom = [
  run.trace_id,
  run.status,
  run.source,
  sanitizeTraceText(run.input_text),
  sanitizeTraceText(run.robot_id),
  sanitizeTraceText(run.final_response),
  sanitizeTraceText(run.outcome),
  JSON.stringify(safeTraceError(run.error)),
  JSON.stringify(summary),
].join("\n");
assertNoSecrets("run detail", detailLikeDom);

const timelineCollapsedDom = groups.map((group) => [
  group.label,
  group.failed ? "failed" : "ok",
  group.events.length,
  group.events.map((event) => [
    event.sequence,
    sanitizeTraceText(event.type),
    sanitizeTraceText(event.model ?? ""),
    JSON.stringify(safeTraceError(event.error, { allowMessage: !event.type.startsWith("llm.") })),
  ]).join("\n"),
]).join("\n");
assertNoSecrets("collapsed timeline", timelineCollapsedDom);
assert.ok(!timelineCollapsedDom.includes("VISIBLE_RESULT"), "collapsed timeline should not include JSON details by default");

const expandedSafeJson = [
  safeTraceJson(events[3].metadata),
  safeTraceJson(events[4].arguments),
  safeTraceJson(events[4].result_summary),
  safeTraceJson(events[6].metadata),
  safeTraceJson(events[6].result_summary),
].filter(Boolean).join("\n");
assertNoSecrets("expanded timeline json", expandedSafeJson);
assert.ok(expandedSafeJson.includes("VISIBLE_RESULT"));
assert.ok(expandedSafeJson.includes("VISIBLE_UNKNOWN"));

console.log("Trace acceptance verification passed.");
