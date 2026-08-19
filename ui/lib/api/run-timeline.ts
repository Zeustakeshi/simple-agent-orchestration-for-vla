/* Dịch `TraceEvent[]` của backend sang `TimelineEntry[]` mà `TimelineView` vẽ.
 *
 * Cùng vai trò với `trace-translate.ts` nhưng cho trang Nhật ký chi tiết (P09):
 * ở đó là luồng SSE đang chạy, ở đây là lịch sử đã lưu. Hai nơi đọc cùng một
 * kho sự kiện nhưng cần hai hình dạng khác nhau, nên tách riêng.
 *
 * Thuần, không I/O — cùng lý do như `trace-translate`. */

import type { TraceEvent } from "./runs";
import type { TimelineEntry } from "@/components/logs/TimelineView";
import type { AgentStep, AgentStatusLabel, ToolCall, ToolStatus } from "@/stores";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Id của lời gọi tool — emitter lưu payload gốc vào `metadata`. */
function toolCallId(event: TraceEvent): string {
  return str(event.metadata?.id) ?? `${event.run_id}-${event.sequence}`;
}

/* Cùng bảng ánh xạ với `trace-translate.ts`, nhưng ở đây đi từ `type` gốc vì
   sự kiện lưu trong kho chưa qua bước chiếu sang `stage`. */
const EVENT_STAGE: Record<string, string> = {
  "run.started": "initializing",
  "llm.started": "model_call",
  "llm.completed": "model_call",
  "llm.failed": "model_call",
  "tool.started": "tool_execution",
  "tool.completed": "tool_execution",
  "tool.failed": "tool_execution",
  "episode.started": "robot_episode",
  "episode.progress": "robot_episode",
  "episode.completed": "robot_episode",
  "run.completed": "finished",
  "run.failed": "finished",
  "run.cancelled": "finished",
  "run.timeout": "finished",
};

const STAGE_LABEL: Record<string, AgentStatusLabel | undefined> = {
  initializing: "Đang hiểu yêu cầu",
  model_call: "Đang lập kế hoạch",
  tool_execution: "Đang thực thi",
  robot_episode: "Đang thực thi",
  finished: "Đang kiểm tra kết quả",
};

const TOOL_STATUS_BY_TYPE: Record<string, ToolStatus> = {
  "tool.started": "RUNNING",
  "tool.completed": "SUCCEEDED",
  "tool.failed": "FAILED",
};

/** Gộp `tool.started` với `tool.completed`/`tool.failed` thành MỘT dòng.
 *
 * Timeline kể một lời gọi tool là một mắt xích, không phải hai. Ghép theo id;
 * sự kiện kết thúc mang `duration_ms` và lỗi, sự kiện bắt đầu mang tham số. */
export function buildToolCalls(events: TraceEvent[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const event of events) {
    const status = TOOL_STATUS_BY_TYPE[event.type];
    if (!status) continue;
    const id = toolCallId(event);
    const existing = calls.get(id);
    const error = event.error
      ? {
          code: str(event.error.code) ?? "AGENT_002",
          message: str(event.error.message) ?? "Tool thất bại.",
        }
      : existing?.error;
    calls.set(id, {
      id,
      tool_name: str(event.tool_name) ?? existing?.tool_name ?? "unknown_tool",
      arguments: event.arguments ?? existing?.arguments ?? {},
      /* Trạng thái chỉ TIẾN, không lùi: `tool.started` đến sau `tool.completed`
         (thứ tự đảo do sequence) không được kéo dòng về lại "đang chạy". */
      status: existing && existing.status !== "RUNNING" ? existing.status : status,
      duration_ms: num(event.duration_ms) ?? existing?.duration_ms,
      error,
    });
  }
  return calls;
}

export function traceEventsToTimeline(events: TraceEvent[]): TimelineEntry[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const calls = buildToolCalls(ordered);
  const seenToolRows = new Set<string>();
  const entries: TimelineEntry[] = [];

  for (const event of ordered) {
    switch (event.type) {
      case "run.started":
        entries.push({
          kind: "run_started",
          at: event.timestamp,
          source: str(event.metadata?.source) ?? "CHAT",
        });
        break;

      case "llm.completed":
        entries.push({
          kind: "llm_call",
          at: event.timestamp,
          model: str(event.model) ?? "—",
          input_tokens: num(event.metadata?.input_tokens) ?? 0,
          output_tokens: num(event.metadata?.output_tokens) ?? 0,
          duration_ms: num(event.duration_ms) ?? 0,
        });
        break;

      case "tool.started": {
        /* Dòng tool đặt ở vị trí BẮT ĐẦU — đó là lúc hành động xảy ra. Nhưng
           nội dung lấy từ bản đã gộp, nên nó mang cả kết quả và thời lượng. */
        const id = toolCallId(event);
        const call = calls.get(id);
        if (call && !seenToolRows.has(id)) {
          seenToolRows.add(id);
          entries.push({ kind: "tool_call", at: event.timestamp, toolCall: call });
        }
        break;
      }

      case "run.completed":
      case "run.failed":
      case "run.cancelled":
      case "run.timeout":
        entries.push({
          kind: "run_completed",
          at: event.timestamp,
          ok: event.type === "run.completed",
          outcome: event.type.split(".")[1].toUpperCase(),
        });
        break;

      /* `llm.started`, `episode.*`, `robot.state.updated`… không thành dòng
         riêng: timeline kể các mắt xích của lượt chạy, không phải mọi tick nội
         bộ. Episode đã nằm trong chi tiết của chính tool `take_action`. */
      default:
        break;
    }
  }

  return entries;
}

/* --------------------------------------------------- dựng lại trace lịch sử */

/** Chặng đường agent đã đi, dựng lại từ kho sự kiện của một lượt chạy.
 *
 * Dùng khi MỞ LẠI một phiên cũ. Trace lúc chạy sống trong store phía client và
 * mất khi tải lại trang; backend không lưu `agent_steps` cùng tin nhắn. Nhưng
 * kho sự kiện trace thì còn nguyên, và nó là nguồn đáng tin hơn — cùng dữ liệu
 * mà trang Nhật ký đọc, nên hai nơi không thể kể hai câu chuyện khác nhau.
 *
 * `startedAt`/`endedAt` lấy từ MỐC THẬT của sự kiện, không phải giờ client lúc
 * tải lại: mở một phiên của tuần trước mà thấy "vừa xong 2 giây trước" thì còn
 * tệ hơn không hiện gì. */
export function traceEventsToAgentSteps(events: TraceEvent[]): AgentStep[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const steps: AgentStep[] = [];

  for (const event of ordered) {
    const label = STAGE_LABEL[EVENT_STAGE[event.type] ?? ""];
    if (!label) continue;
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at)) continue;

    const last = steps[steps.length - 1];
    // Cùng nhãn với bước đang mở thì vẫn là bước đó — cùng quy tắc gộp như
    // `pushAgentStep`, nếu không lịch sử sẽ dài hơn lúc chạy trực tiếp.
    if (last && last.label === label && last.endedAt === undefined) continue;
    if (last && last.endedAt === undefined) last.endedAt = at;
    steps.push({ id: `step-${event.sequence}`, label, startedAt: at });
  }

  const last = steps[steps.length - 1];
  if (last && last.endedAt === undefined) {
    const end = Date.parse(ordered[ordered.length - 1]?.timestamp ?? "");
    last.endedAt = Number.isFinite(end) ? end : last.startedAt;
  }
  return steps;
}

/** Tool đã gọi trong một lượt chạy, theo đúng thứ tự xảy ra. */
export function traceEventsToToolCalls(events: TraceEvent[]): ToolCall[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const calls = buildToolCalls(ordered);
  const out: ToolCall[] = [];
  const seen = new Set<string>();
  for (const event of ordered) {
    if (event.type !== "tool.started") continue;
    const id = toolCallId(event);
    if (seen.has(id)) continue;
    const call = calls.get(id);
    if (!call) continue;
    seen.add(id);
    const at = Date.parse(event.timestamp);
    out.push({ ...call, started_at: Number.isFinite(at) ? at : undefined });
  }
  return out;
}
