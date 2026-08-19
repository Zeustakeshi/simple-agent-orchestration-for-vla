/* trace-translate — dịch sự kiện trace của backend sang từ vựng `SseEvent`.
 *
 * Tách khỏi `trace-stream.ts` vì đây là phần THUẦN: không fetch, không token,
 * không phụ thuộc trình duyệt. Nhờ vậy kiểm được bằng một script Node chạy
 * thẳng trên payload thật do backend sinh ra (`npm run verify:trace-translate`)
 * — không phải mở trình duyệt rồi cầu may.
 *
 * Chỉ `import type` ở đây, có chủ đích: import kiểu bị xoá lúc biên dịch nên
 * file này nạp được bằng `node --experimental-strip-types` mà không cần alias
 * `@/` hay bundler.
 */

import type { SseEvent } from "@/lib/mock/sse";
import type { EpisodeOutcome } from "@/stores";

/** Hình dạng backend gửi ra — xem `project_trace_event`. */
export interface TracePayload {
  type: "agent.thinking";
  /** Tên sự kiện GỐC (`tool.started`, `run.completed`…). Đây là thứ dịch dựa vào. */
  event_type?: string;
  run_id?: string;
  trace_id?: string;
  sequence?: number;
  timestamp?: string;
  stage?: string;
  status?: string;
  label?: string;
  message?: string | null;
  duration_ms?: number | null;
  error?: { code?: string; message?: string } | null;
  tool_name?: string;
  tool_call_id?: string;
  arguments?: Record<string, unknown>;
  episode_id?: string;
  episode?: {
    step?: number;
    steps?: number;
    max_steps?: number;
    elapsed_s?: number;
    estimated_duration_s?: number;
    outcome?: string;
    stop_reason?: string;
  };
}

/* `stage` → nhãn giai đoạn, thuộc TẬP ĐÓNG của `AgentStatusLabel`.
 *
 * Ánh xạ từ `stage` chứ KHÔNG từ `label`/`message` của backend: hai trường đó
 * là văn bản tự do, và `agent.thinking` vốn là kênh chở suy luận của model —
 * đổ thẳng lên giao diện là vi phạm MASTER §13.2. `stage` chỉ là một enum về
 * việc agent đang ở chặng nào, không mang nội dung suy nghĩ. */
const STAGE_STATUS: Record<string, string> = {
  initializing: "Đang hiểu yêu cầu",
  model_call: "Đang lập kế hoạch",
  tool_execution: "Đang thực thi",
  robot_episode: "Đang thực thi",
  finished: "Đang kiểm tra kết quả",
};

const EPISODE_OUTCOMES: EpisodeOutcome[] = [
  "SUCCESS",
  "STOPPED",
  "TIMEOUT",
  "MAX_STEPS",
  "SAFETY_ABORT",
];

function toOutcome(value: string | undefined): EpisodeOutcome {
  const match = EPISODE_OUTCOMES.find((o) => o === value);
  /* Không đoán thành SUCCESS khi thiếu: một episode kết thúc mà không nói rõ
     kết quả thì "đã dừng" là mô tả trung thực, còn "thành công" là bịa. */
  return match ?? "STOPPED";
}

function errorOf(payload: TracePayload, fallbackCode: string): { code: string; message: string } {
  return {
    code: payload.error?.code ?? fallbackCode,
    message: payload.error?.message ?? "Lượt chạy thất bại.",
  };
}

/** Dịch một payload thành 0..n `SseEvent`.
 *
 * Trả về MẢNG vì có sự kiện backend gộp việc: `episode.completed` vừa kết thúc
 * episode vừa là chỗ duy nhất mang `outcome`. Và trả rỗng cho những sự kiện
 * giao diện không dùng, thay vì ép chúng thành một loại gần đúng. */
/** Tra id của lời gọi đang mở theo tên tool. Xem `resolveOpenToolId` bên dưới. */
export type OpenToolResolver = (toolName: string) => string | undefined;

export function traceEventToSse(
  payload: TracePayload,
  /* LƯỚI AN TOÀN cho `tool.completed`/`tool.failed` thiếu `id`.
   *
   * `nodes/tool.py` gửi đủ id, nhưng `api/routes.py` còn năm chỗ khác ghi
   * thẳng TraceEvent mà không kèm id — và mỗi lần thiếu, dòng tool sẽ QUAY MÃI
   * dù tool đã xong. Đó là kiểu hỏng tệ nhất: giao diện nói dối là còn đang
   * chạy, người dùng ngồi chờ một thứ đã kết thúc.
   *
   * Có resolver thì lấy lời gọi đang mở gần nhất CÙNG TÊN TOOL. Không hoàn hảo
   * — gọi song song hai lần cùng một tool thì có thể đóng nhầm cái — nhưng
   * đóng nhầm một dòng vẫn tốt hơn treo vĩnh viễn cả hai. */
  resolveOpenToolId?: OpenToolResolver,
): SseEvent[] {
  const type = payload.event_type;
  const out: SseEvent[] = [];

  const closingId =
    payload.tool_call_id ??
    (payload.tool_name ? resolveOpenToolId?.(payload.tool_name) : undefined);

  /* Nhãn giai đoạn đi kèm MỌI sự kiện có `stage` biết được. Nhờ vậy hàng giai
     đoạn trong trace vẫn xuất hiện dù backend không hề phát `agent.status` —
     store tự lọc trùng nên phát lại cùng một nhãn là vô hại. */
  const status = payload.stage ? STAGE_STATUS[payload.stage] : undefined;
  if (status) out.push({ type: "agent.status", status });

  switch (type) {
    case "run.started":
      if (payload.run_id) {
        out.push({ type: "run.started", run_id: payload.run_id, input_text: "" });
      }
      break;

    case "tool.started":
      /* Không có `tool_call_id` thì bỏ qua hẳn: dựng một dòng không đóng lại
         được sẽ kẹt ở trạng thái "đang chạy" mãi mãi sau khi lượt chạy xong. */
      if (payload.tool_call_id && payload.tool_name) {
        out.push({
          type: "tool.started",
          tool_call_id: payload.tool_call_id,
          tool_name: payload.tool_name,
          arguments: payload.arguments ?? {},
        });
      }
      break;

    case "tool.completed":
      if (closingId) {
        out.push({
          type: "tool.completed",
          tool_call_id: closingId,
          status: "SUCCEEDED",
          result: {},
          duration_ms: payload.duration_ms ?? 0,
        });
      }
      break;

    case "tool.failed":
      if (closingId) {
        out.push({
          type: "tool.failed",
          tool_call_id: closingId,
          error: errorOf(payload, "AGENT_002"),
          duration_ms: payload.duration_ms ?? 0,
        });
      }
      break;

    case "episode.started":
      if (payload.episode_id && payload.tool_call_id) {
        out.push({
          type: "episode.started",
          episode_id: payload.episode_id,
          tool_call_id: payload.tool_call_id,
          max_steps: payload.episode?.max_steps ?? 0,
        });
      }
      break;

    case "episode.progress":
      if (payload.episode_id) {
        out.push({
          type: "episode.progress",
          episode_id: payload.episode_id,
          step: payload.episode?.step ?? payload.episode?.steps ?? 0,
          max_steps: payload.episode?.max_steps ?? 0,
          elapsed_s: payload.episode?.elapsed_s ?? 0,
        });
      }
      break;

    case "episode.completed":
      if (payload.episode_id) {
        out.push({
          type: "episode.completed",
          episode_id: payload.episode_id,
          outcome: toOutcome(payload.episode?.outcome),
          steps: payload.episode?.steps ?? payload.episode?.step ?? 0,
          duration_s: payload.episode?.elapsed_s ?? 0,
          stop_reason: payload.episode?.stop_reason,
        });
      }
      break;

    case "run.completed":
      if (payload.run_id) out.push({ type: "run.completed", run_id: payload.run_id });
      break;

    case "run.cancelled":
      if (payload.run_id) out.push({ type: "run.cancelled", run_id: payload.run_id });
      break;

    case "run.failed":
      if (payload.run_id) {
        out.push({ type: "run.failed", run_id: payload.run_id, error: errorOf(payload, "AGENT_001") });
      }
      break;

    case "run.timeout":
      /* Giao diện không có loại riêng cho quá giờ — quy về `run.failed` với mã
         AGENT_003 để `i18n/errors.vi.json` nói đúng nguyên nhân. Bỏ qua thì
         lượt chạy kẹt "đang chạy" vĩnh viễn và ô nhập không mở khoá lại. */
      if (payload.run_id) {
        out.push({
          type: "run.failed",
          run_id: payload.run_id,
          error: {
            code: payload.error?.code ?? "AGENT_003",
            message: payload.error?.message ?? "Lượt chạy vượt quá thời gian cho phép.",
          },
        });
      }
      break;

    /* `llm.*`, `system.warning`, `robot.state.updated`… chỉ đóng góp nhãn giai
       đoạn ở trên. Không dựng dòng riêng: một dòng "Gọi model" giữa trace không
       nói cho người dùng biết agent đang LÀM gì, mà đây là kênh dễ chở nội dung
       suy luận nhất. */
    default:
      break;
  }

  return out;
}

/** Sự kiện kết thúc — chỗ gọi dừng chờ và đi lấy câu trả lời cuối. */
export function isTerminalTrace(payload: TracePayload): boolean {
  return (
    payload.event_type === "run.completed" ||
    payload.event_type === "run.failed" ||
    payload.event_type === "run.cancelled" ||
    payload.event_type === "run.timeout"
  );
}
