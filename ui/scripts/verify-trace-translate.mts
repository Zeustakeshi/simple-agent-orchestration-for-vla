/* Kiểm bộ dịch sự kiện trace: backend → `SseEvent`.
 *
 * Chạy trên ĐÚNG hình dạng payload mà `agents/thinking_stream.py` sinh ra, nên
 * hai phía lệch nhau là script này gãy — chứ không phải phát hiện lúc demo.
 *
 * `.mts` chứ không phải `.mjs` như các script verify khác: mô-đun được kiểm là
 * TypeScript, và `node --experimental-strip-types` nạp thẳng được vì
 * `trace-translate.ts` cố ý chỉ có `import type`.
 *
 *   npm run verify:trace-translate
 */

import assert from "node:assert/strict";
import { traceEventToSse, isTerminalTrace } from "../lib/api/trace-translate.ts";

let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

/* Payload dưới đây chép nguyên từ đầu ra thật của `project_trace_event`. */

check("tool.started giữ tên tool và tham số — thứ làm nên dòng hành động", () => {
  const [status, tool] = traceEventToSse({
    type: "agent.thinking",
    event_type: "tool.started",
    stage: "tool_execution",
    tool_name: "capture_tool",
    tool_call_id: "call_1",
    arguments: { cameras: ["top", "wrist"] },
  });
  assert.deepEqual(status, { type: "agent.status", status: "Đang thực thi" });
  assert.deepEqual(tool, {
    type: "tool.started",
    tool_call_id: "call_1",
    tool_name: "capture_tool",
    arguments: { cameras: ["top", "wrist"] },
  });
});

check("thiếu tool_call_id thì KHÔNG dựng dòng — dòng không đóng được sẽ kẹt mãi", () => {
  const events = traceEventToSse({
    type: "agent.thinking",
    event_type: "tool.started",
    stage: "tool_execution",
    tool_name: "capture_tool",
  });
  assert.equal(events.filter((e) => e.type === "tool.started").length, 0);
});

check("tool.completed đóng đúng dòng đã mở", () => {
  const events = traceEventToSse({
    type: "agent.thinking",
    event_type: "tool.completed",
    stage: "tool_execution",
    tool_call_id: "call_1",
    duration_ms: 812,
  });
  const done = events.find((e) => e.type === "tool.completed");
  assert.deepEqual(done, {
    type: "tool.completed",
    tool_call_id: "call_1",
    status: "SUCCEEDED",
    result: {},
    duration_ms: 812,
  });
});

check("tool.completed thiếu id vẫn đóng được nhờ resolver — không để dòng quay mãi", () => {
  const events = traceEventToSse(
    {
      type: "agent.thinking",
      event_type: "tool.completed",
      stage: "tool_execution",
      tool_name: "capture_tool",
      duration_ms: 500,
    },
    (name) => (name === "capture_tool" ? "call_1" : undefined),
  );
  const done = events.find((e) => e.type === "tool.completed");
  assert.ok(done && done.type === "tool.completed");
  assert.equal(done.tool_call_id, "call_1");
});

check("id thật luôn thắng resolver", () => {
  const [, done] = traceEventToSse(
    {
      type: "agent.thinking",
      event_type: "tool.completed",
      stage: "tool_execution",
      tool_name: "capture_tool",
      tool_call_id: "call_that",
    },
    () => "call_doan",
  );
  assert.equal(done.type === "tool.completed" && done.tool_call_id, "call_that");
});

check("episode.progress mang đủ số cho thanh tiến độ", () => {
  const events = traceEventToSse({
    type: "agent.thinking",
    event_type: "episode.progress",
    stage: "robot_episode",
    episode_id: "ep_1",
    episode: { step: 120, max_steps: 400, elapsed_s: 12 },
  });
  assert.deepEqual(events.find((e) => e.type === "episode.progress"), {
    type: "episode.progress",
    episode_id: "ep_1",
    step: 120,
    max_steps: 400,
    elapsed_s: 12,
  });
});

check("episode thiếu outcome ra STOPPED, không tự nhận SUCCESS", () => {
  const [, done] = traceEventToSse({
    type: "agent.thinking",
    event_type: "episode.completed",
    stage: "robot_episode",
    episode_id: "ep_1",
    episode: { steps: 360 },
  });
  assert.equal(done.type === "episode.completed" && done.outcome, "STOPPED");
});

check("run.timeout quy về run.failed AGENT_003 — nếu bỏ qua, ô nhập kẹt khoá", () => {
  const events = traceEventToSse({
    type: "agent.thinking",
    event_type: "run.timeout",
    stage: "finished",
    run_id: "run_x",
  });
  const failed = events.find((e) => e.type === "run.failed");
  assert.ok(failed && failed.type === "run.failed");
  assert.equal(failed.error.code, "AGENT_003");
});

check("mọi sự kiện kết thúc đều nhận ra được", () => {
  for (const t of ["run.completed", "run.failed", "run.cancelled", "run.timeout"]) {
    assert.ok(isTerminalTrace({ type: "agent.thinking", event_type: t }), t);
  }
  assert.equal(isTerminalTrace({ type: "agent.thinking", event_type: "tool.started" }), false);
});

check("llm.* chỉ góp nhãn giai đoạn, không thành dòng riêng (§13.2)", () => {
  const events = traceEventToSse({
    type: "agent.thinking",
    event_type: "llm.started",
    stage: "model_call",
    label: "Gọi model",
    message: "suy luận nội bộ không được phép lộ",
  });
  assert.deepEqual(events, [{ type: "agent.status", status: "Đang lập kế hoạch" }]);
});

console.log(`\n${checks} kiểm tra — tất cả đạt.`);
