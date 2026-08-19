import assert from "node:assert/strict";

import {
  safeTraceJson,
  safeTraceError,
  sanitizeTraceText,
  sanitizeTraceValue,
} from "../lib/tracePrivacy.mjs";

const sentinel = {
  Prompt: "SECRET_1",
  nested: {
    reasoning_content: "SECRET_2",
    Authorization: "SECRET_3",
    messages: [{ content: "SECRET_4" }],
    chain_of_thought: "SECRET_COT",
    scratchpad: { analysis: "SECRET_ANALYSIS" },
    safe_field: "VISIBLE",
  },
};
const original = structuredClone(sentinel);

for (const payload of [
  { metadata: sentinel },
  { arguments: sentinel },
  { result_summary: sentinel },
  { error: sentinel },
]) {
  const serialized = safeTraceJson(payload);
  assert.ok(serialized);
  for (const secret of ["SECRET_1", "SECRET_2", "SECRET_3", "SECRET_4"]) {
    assert.ok(!serialized.includes(secret));
  }
  assert.ok(!serialized.includes("SECRET_COT"));
  assert.ok(!serialized.includes("SECRET_ANALYSIS"));
  assert.ok(serialized.includes("VISIBLE"));
}

assert.deepEqual(sentinel, original, "privacy filtering must not mutate its input");
assert.match(safeTraceJson("x".repeat(2_100)), /\[TRUNCATED\]/);
assert.ok(sanitizeTraceValue(Array.from({ length: 60 })).length === 51);
assert.ok(Object.keys(sanitizeTraceValue(Object.fromEntries(
  Array.from({ length: 60 }, (_, index) => [`safe_${index}`, index]),
))).length === 51);

const circular = { safe: "VISIBLE" };
circular.self = circular;
assert.match(safeTraceJson(circular), /\[CIRCULAR\]/);
assert.equal(safeTraceJson(undefined), null);
assert.ok(safeTraceJson({ safe: "x".repeat(20_000) }, 500).length < 550);
assert.ok(!sanitizeTraceText("Authorization: Bearer SECRET_DOM").includes("SECRET_DOM"));
assert.deepEqual(
  safeTraceError({ code: "MCP_001", message: "token=SECRET_ERROR failed" }),
  { code: "MCP_001", message: "token=[REDACTED_SECRET] failed" },
);

console.log("Trace privacy verification passed.");
