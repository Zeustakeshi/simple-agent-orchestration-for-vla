/* Kiểm chứng `lib/api/mvp-chat.ts` bằng một lượt chạy thật đã rút gọn.
 *
 * Chạy: npm run verify:mvp-chat
 *
 * Adapter này là chỗ duy nhất biết cả giao thức của mvp_vla lẫn từ vựng sự kiện
 * của giao diện, nên nó cũng là chỗ duy nhất có thể lặng lẽ làm sai mà build vẫn
 * xanh: TypeScript kiểm được KIỂU của sự kiện phát ra, không kiểm được chúng có
 * đúng thứ tự và đúng cặp hay không. Ba thứ được khẳng định ở đây đều là lỗi đã
 * từng làm hỏng giao diện trong quá trình dựng:
 *
 *   1. Cặp call↔result. Backend không gửi id, ghép sai thì tool card quay mãi.
 *   2. Ranh giới bong bóng. Thiếu `message.completed` trước tool thì lời dẫn và
 *      lời tổng kết dính làm một khối.
 *   3. Vòng đời episode dựng lại từ `take_action` + `check_status`.
 *   4. Suy nghĩ KHÔNG được lẫn vào lời nói, và token điều khiển của model
 *      (`<|channel|>`) không được lọt ra bong bóng chat.
 */

import assert from "node:assert/strict";
import { MvpChatTranslator, parseSseBlock } from "../lib/api/mvp-chat.ts";
import type { SseEvent } from "../lib/mock/sse.ts";

/** Một lượt chạy điển hình: nói → xem trạng thái → chụp → thao tác → thăm dò. */
const TRANSCRIPT: [string, unknown][] = [
  ["agent_text", { text: "Tôi sẽ " }],
  ["agent_text", { text: "kiểm tra robot." }],
  ["tool_call", { name: "get_robot_state", args: {} }],
  ["tool_result", { name: "get_robot_state", result: { busy: false, retry_count: 0 } }],
  ["tool_call", { name: "capture", args: {} }],
  ["tool_result", { name: "capture", result: { ok: true } }],
  ["tool_call", { name: "take_action", args: { subgoal: "bỏ hộp sữa vào giỏ", k: 120 } }],
  ["tool_result", { name: "take_action", result: { task_id: "task-7", status: "RUNNING" } }],
  ["tool_call", { name: "check_status", args: { task_id: "task-7", wait_s: 5 } }],
  ["tool_result", { name: "check_status", result: { status: "RUNNING", step: 40, total: 120 } }],
  ["tool_call", { name: "check_status", args: { task_id: "task-7", wait_s: 5 } }],
  ["tool_result", { name: "check_status", result: { status: "DONE", step: 118, total: 120, success: true } }],
  ["agent_text", { text: "Đã xong." }],
  ["done", {}],
];

function run(transcript: [string, unknown][]): SseEvent[] {
  const out: SseEvent[] = [];
  const translator = new MvpChatTranslator("run-x", (e) => out.push(e));
  for (const [event, data] of transcript) {
    const parsed = parseSseBlock(`event: ${event}\ndata: ${JSON.stringify(data)}`);
    assert.ok(parsed, `không parse được khối SSE: ${event}`);
    translator.handle(parsed);
  }
  return out;
}

const events = run(TRANSCRIPT);
const types = events.map((e) => e.type);

/* ---- 1. mỗi tool.started có đúng một sự kiện kết thúc, cùng id ---- */
const started = events.filter((e) => e.type === "tool.started");
const finished = events.filter((e) => e.type === "tool.completed" || e.type === "tool.failed");
assert.equal(started.length, 5, `phải có 5 tool.started, nhận ${started.length}`);
assert.equal(finished.length, 5, `phải có 5 sự kiện kết thúc, nhận ${finished.length}`);
assert.deepEqual(
  finished.map((e) => ("tool_call_id" in e ? e.tool_call_id : "")),
  started.map((e) => ("tool_call_id" in e ? e.tool_call_id : "")),
  "kết quả ghép sai cặp với lời gọi — thứ tự FIFO theo tên đã hỏng",
);

/* Hai lần `check_status` phải ra hai id KHÁC nhau. Dùng chung id thì lần thăm
   dò thứ hai ghi đè lên thẻ thứ nhất và trace mất một bước. */
const pollIds = started.filter((e) => "tool_name" in e && e.tool_name === "check_status").map((e) => ("tool_call_id" in e ? e.tool_call_id : ""));
assert.equal(new Set(pollIds).size, 2, "hai lần check_status dùng chung một id");

/* ---- 2. chữ và tool không lẫn vào nhau ---- */
assert.equal(
  types.filter((t) => t === "message.completed").length,
  2,
  "phải có đúng 2 bong bóng: lời dẫn trước tool, lời tổng kết sau",
);
const firstToolAt = types.indexOf("tool.started");
assert.ok(
  types.indexOf("message.completed") < firstToolAt,
  "bong bóng đầu chưa được chốt trước tool đầu tiên — chữ trước và sau tool sẽ dính nhau",
);
// Hai token của câu đầu phải cùng một message_id.
const deltas = events.filter((e) => e.type === "token.delta");
assert.equal(deltas.length, 3);
assert.equal(
  "message_id" in deltas[0] ? deltas[0].message_id : "",
  "message_id" in deltas[1] ? deltas[1].message_id : "",
  "hai token của cùng một câu rơi vào hai bong bóng",
);

/* ---- 3. episode dựng lại từ take_action + check_status ---- */
const epStarted = events.find((e) => e.type === "episode.started");
assert.ok(epStarted && "max_steps" in epStarted && epStarted.max_steps === 120, "max_steps phải lấy từ tham số `k`");
assert.ok(epStarted && "instruction" in epStarted && epStarted.instruction === "bỏ hộp sữa vào giỏ", "instruction phải lấy từ `subgoal`");
const epProgress = events.filter((e) => e.type === "episode.progress");
assert.equal(epProgress.length, 1, "một lần `status: RUNNING` phải ra một episode.progress");
const epDone = events.find((e) => e.type === "episode.completed");
assert.ok(epDone && "outcome" in epDone && epDone.outcome === "SUCCESS", "DONE + success phải ra SUCCESS");

/* ---- 4. thất bại của edge phải thành tool.failed ---- */
const failed = run([
  ["tool_call", { name: "take_action", args: { subgoal: "x", k: 10 } }],
  ["tool_result", { name: "take_action", result: { task_id: "t1", status: "RUNNING" } }],
  ["tool_call", { name: "check_status", args: {} }],
  ["tool_result", { name: "check_status", result: { status: "SAFETY_STOP", reason: "va chạm", step: 3 } }],
  ["done", {}],
]);
const safety = failed.find((e) => e.type === "tool.failed");
assert.ok(safety, "SAFETY_STOP phải thành tool.failed, không phải tool.completed");
assert.ok("error" in safety && safety.error.code === "SAFETY_STOP");
assert.ok("error" in safety && safety.error.message.includes("va chạm"), "lý do từ edge phải được giữ lại");
const safetyEpisode = failed.find((e) => e.type === "episode.completed");
assert.ok(safetyEpisode && "outcome" in safetyEpisode && safetyEpisode.outcome === "SAFETY_ABORT");

/* `DONE` nhưng `success: false` KHÔNG phải thành công — agent sẽ xem ảnh rồi
   thử lại, thanh tiến độ không được báo xanh. */
const notYet = run([
  ["tool_call", { name: "take_action", args: { subgoal: "x", k: 10 } }],
  ["tool_result", { name: "take_action", result: { task_id: "t2" } }],
  ["tool_call", { name: "check_status", args: {} }],
  ["tool_result", { name: "check_status", result: { status: "DONE", success: false, step: 10 } }],
]);
const notYetEpisode = notYet.find((e) => e.type === "episode.completed");
assert.ok(notYetEpisode && "outcome" in notYetEpisode && notYetEpisode.outcome !== "SUCCESS", "DONE + success:false không được là SUCCESS");
// Bản thân tool vẫn thành công: nó đã chạy xong đúng như được yêu cầu.
assert.ok(notYet.some((e) => e.type === "tool.completed"));

/* ---- 5. kết quả tới mà chưa từng thấy lời gọi vẫn phải có chỗ đậu ---- */
const orphan = run([["tool_result", { name: "go_home", result: { status: "DONE" } }]]);
assert.equal(orphan.filter((e) => e.type === "tool.started").length, 1, "kết quả mồ côi bị đánh rơi");
assert.equal(orphan.filter((e) => e.type === "tool.completed").length, 1);

/* ---- 6. suy nghĩ đi đường riêng, token điều khiển không lọt ra ---- */
const thinking = run([
  ["agent_reasoning", { text: "Người dùng muốn xem bàn. " }],
  ["agent_reasoning", { text: "Mình sẽ chụp ảnh trước." }],
  ["agent_text", { text: "Để tôi xem nhé." }],
  ["agent_message_end", {}],
  ["tool_call", { id: "call_a", name: "capture", args: {} }],
  ["tool_result", { id: "call_a", name: "capture", result: { ok: true } }],
  ["done", {}],
]);

const thoughtDeltas = thinking.filter((e) => e.type === "thinking.delta");
assert.equal(thoughtDeltas.length, 2, "suy nghĩ phải ra thinking.delta, không phải token.delta");
assert.equal(
  "message_id" in thoughtDeltas[0] ? thoughtDeltas[0].message_id : "",
  "message_id" in thoughtDeltas[1] ? thoughtDeltas[1].message_id : "",
  "hai mẩu suy nghĩ liền nhau bị xé thành hai khối",
);
assert.ok(
  thinking.some((e) => e.type === "thinking.completed"),
  "khối suy nghĩ không bao giờ được chốt — nó sẽ quay mãi trong giao diện",
);
/* Suy nghĩ phải chốt TRƯỚC khi tool nổ: đoạn nghĩ dẫn tới hành động này đã
   xong ngay khi hành động bắt đầu. */
const thinkingTypes = thinking.map((e) => e.type);
assert.ok(
  thinkingTypes.indexOf("thinking.completed") < thinkingTypes.indexOf("tool.started"),
  "suy nghĩ còn mở khi tool đã chạy",
);
// Và không một mẩu nào của nó rơi vào bong bóng trả lời.
const saidText = thinking
  .filter((e) => e.type === "token.delta")
  .map((e) => ("delta" in e ? e.delta : ""))
  .join("");
assert.equal(saidText, "Để tôi xem nhé.", "suy nghĩ lẫn vào lời nói");

/* Id thật của backend được dùng thẳng — đây là thứ ghép đúng cặp khi model gọi
   song song hai lần cùng một tool. */
const calledId = thinking.find((e) => e.type === "tool.started");
assert.ok(calledId && "tool_call_id" in calledId && calledId.tool_call_id === "call_a", "id của backend bị bỏ qua");

/* Token điều khiển sót lại (model lạ, backend cũ) không được ra tới màn hình. */
const leaked = run([
  ["agent_text", { text: "<|channel|>final<|message|>Xong rồi." }],
  ["done", {}],
]);
const leakedText = leaked
  .filter((e) => e.type === "token.delta")
  .map((e) => ("delta" in e ? e.delta : ""))
  .join("");
assert.equal(leakedText, "Xong rồi.", `token điều khiển lọt ra bong bóng chat: ${JSON.stringify(leakedText)}`);

console.log(`✓ mvp-chat: ${events.length} sự kiện, 5 cặp tool, episode + nhánh lỗi đều đúng`);
