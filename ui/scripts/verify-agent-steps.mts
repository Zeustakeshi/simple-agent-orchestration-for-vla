/* Kiểm `pushAgentStep`: cùng một nhãn phát nhiều lần liên tiếp thì chỉ ra MỘT
 * dòng, không phải một dòng cho mỗi lần phát.
 *
 * Backend thật phát cùng một `stage` nhiều lần trong một chặng — mỗi
 * `episode.progress` một lần — nên lỗi này chỉ lộ khi chạy dữ liệu thật; với
 * mock, mỗi nhãn phát đúng một lần nên trace trông vẫn sạch.
 *
 *   npm run verify:agent-steps
 */

import assert from "node:assert/strict";
import { useRealtimeStore, type AgentStatusLabel } from "../stores/index.ts";

let checks = 0;
function check(name: string, fn: () => void) {
  useRealtimeStore.getState().resetAgentSteps();
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

/* `AgentStatusLabel` là union đóng; script này gõ nhãn dưới dạng chuỗi thường
   nên ép kiểu ở một chỗ duy nhất thay vì rải khắp nơi. Nhãn sai chính tả vẫn
   lọt qua đây, nhưng đó không phải thứ script này kiểm — nó kiểm việc GỘP dòng. */
const push = (label: string) =>
  useRealtimeStore.getState().pushAgentStep(label as AgentStatusLabel);
const steps = () => useRealtimeStore.getState().agentSteps;

check("phát lại cùng nhãn 5 lần → vẫn một dòng", () => {
  for (let i = 0; i < 5; i += 1) push("Đang thực thi");
  assert.equal(steps().length, 1);
  assert.equal(steps()[0].label, "Đang thực thi");
});

check("bước đang mở không bị đóng bởi chính nhãn của nó", () => {
  push("Đang thực thi");
  push("Đang thực thi");
  assert.equal(steps()[0].endedAt, undefined);
});

check("đổi nhãn thì mở dòng mới và đóng dòng cũ", () => {
  push("Đang quan sát");
  push("Đang thực thi");
  assert.equal(steps().length, 2);
  assert.notEqual(steps()[0].endedAt, undefined);
  assert.equal(steps()[1].endedAt, undefined);
});

check("quay lại nhãn cũ SAU một nhãn khác thì đúng là dòng mới", () => {
  push("Đang thực thi");
  push("Đang lập kế hoạch");
  push("Đang thực thi");
  assert.deepEqual(
    steps().map((s) => s.label),
    ["Đang thực thi", "Đang lập kế hoạch", "Đang thực thi"],
  );
});

check("chuỗi thật của một lượt chạy không sinh dòng trùng liền nhau", () => {
  /* Đúng thứ tự stage mà backend phát cho lệnh "nhặt cốc đỏ". */
  for (const label of [
    "Đang hiểu yêu cầu",
    "Đang lập kế hoạch",
    "Đang thực thi", "Đang thực thi", "Đang thực thi",
    "Đang lập kế hoạch",
    "Đang thực thi", "Đang thực thi", "Đang thực thi", "Đang thực thi", "Đang thực thi",
    "Đang lập kế hoạch",
    "Đang kiểm tra kết quả",
  ]) push(label);

  const labels = steps().map((s) => s.label);
  assert.deepEqual(labels, [
    "Đang hiểu yêu cầu",
    "Đang lập kế hoạch",
    "Đang thực thi",
    "Đang lập kế hoạch",
    "Đang thực thi",
    "Đang lập kế hoạch",
    "Đang kiểm tra kết quả",
  ]);
  for (let i = 1; i < labels.length; i += 1) {
    assert.notEqual(labels[i], labels[i - 1], `dòng ${i} trùng dòng trước`);
  }
});

console.log(`\n${checks} kiểm tra — tất cả đạt.`);
