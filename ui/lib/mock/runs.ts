/* Mock runs & logs — MASTER §19 */
import type { Run, RunSource, ToolCall } from "@/stores";
import type { RunSummary, RunDetail } from "@/lib/api/runs";
import { mockDelay } from ".";

export const mockRuns: Run[] = [
  {
    id: "run-001",
    session_id: "session-001",
    robot_id: "robot-001",
    status: "COMPLETED",
    source: "CHAT",
    input_text: "Sắp xếp các linh kiện trên khay theo màu",
    created_at: "2026-08-11T06:01:00Z",
    completed_at: "2026-08-11T06:25:00Z",
    duration_s: 1440,
    trace_id: "tr-a1b2c3d4e5f6",
    outcome: "SUCCEEDED",
    episodes: [{ id: "ep-001", outcome: "SUCCESS", steps: 180, max_steps: 400, duration_s: 22 }],
  },
  {
    id: "run-002",
    session_id: "session-003",
    robot_id: "robot-001",
    status: "FAILED",
    source: "CHAT",
    input_text: "Di chuyển tất cả hộp từ kệ A sang kệ B",
    created_at: "2026-08-10T14:01:00Z",
    completed_at: "2026-08-10T14:20:00Z",
    duration_s: 1140,
    trace_id: "tr-f6e5d4c3b2a1",
    outcome: "FAILED",
    error: { code: "ROBOT_021", message: "Phát hiện lực bất thường, dừng an toàn" },
    episodes: [
      { id: "ep-r2-1", outcome: "SUCCESS", steps: 200, max_steps: 400, duration_s: 25 },
      { id: "ep-r2-2", outcome: "SAFETY_ABORT", steps: 15, max_steps: 400, duration_s: 2, stop_reason: "Phát hiện lực bất thường trên khớp elbow" },
    ],
  },
  {
    id: "run-003",
    session_id: "session-002",
    robot_id: "robot-001",
    status: "RUNNING",
    source: "CHAT",
    input_text: "Kiểm tra chất lượng 5 mẫu trong lô B-42",
    created_at: "2026-08-11T05:01:00Z",
    completed_at: null,
    duration_s: null,
    trace_id: "tr-789abc012345",
    episodes: [{ id: "ep-r3-1", outcome: "SUCCESS", steps: 150, max_steps: 400, duration_s: 18 }],
  },
  {
    id: "run-004",
    session_id: "session-001",
    robot_id: "robot-001",
    status: "CANCELLED",
    source: "SCHEDULE",
    input_text: "Kiểm tra khay linh kiện tự động",
    created_at: "2026-08-10T08:00:00Z",
    completed_at: "2026-08-10T08:02:00Z",
    duration_s: 120,
    trace_id: "tr-sched-cancel-01",
    outcome: "CANCELLED",
    episodes: [{ id: "ep-r4-1", outcome: "STOPPED", steps: 50, max_steps: 400, duration_s: 6, stop_reason: "Người dùng huỷ" }],
  },
  {
    id: "run-005",
    session_id: "session-001",
    robot_id: "robot-001",
    status: "COMPLETED",
    source: "MANUAL_RUN",
    input_text: "Chạy thử nghiệm calibration",
    created_at: "2026-08-09T10:00:00Z",
    completed_at: "2026-08-09T10:05:00Z",
    duration_s: 300,
    trace_id: "tr-manual-001",
    outcome: "SUCCEEDED",
    episodes: [{ id: "ep-r5-1", outcome: "SUCCESS", steps: 120, max_steps: 200, duration_s: 15 }],
  },
];

export interface MockLogEntry {
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
  service: string;
  event: string;
  message: string;
  trace_id?: string;
  attrs?: Record<string, unknown>;
}

export const mockLogs: MockLogEntry[] = [
  { timestamp: "2026-08-11T06:01:00.123Z", level: "INFO", service: "orchestrator", event: "run.started", message: "Bắt đầu run run-001" },
  { timestamp: "2026-08-11T06:01:00.200Z", level: "DEBUG", service: "llm", event: "llm.call", message: "Gọi model gpt-4o-vision, 1200 token đầu vào" },
  { timestamp: "2026-08-11T06:01:01.500Z", level: "INFO", service: "tool-executor", event: "tool.started", message: "Bắt đầu capture_tool" },
  { timestamp: "2026-08-11T06:01:02.000Z", level: "INFO", service: "tool-executor", event: "tool.completed", message: "capture_tool hoàn thành (320ms)" },
  { timestamp: "2026-08-11T06:01:02.500Z", level: "INFO", service: "tool-executor", event: "tool.started", message: "Bắt đầu take_action" },
  { timestamp: "2026-08-11T06:01:10.000Z", level: "INFO", service: "vla-runtime", event: "episode.started", message: "Episode ep-001 bắt đầu" },
  { timestamp: "2026-08-11T06:01:15.000Z", level: "INFO", service: "vla-runtime", event: "episode.progress", message: "Bước 90/400 (22%)" },
  { timestamp: "2026-08-11T06:01:22.000Z", level: "INFO", service: "vla-runtime", event: "episode.completed", message: "Episode hoàn thành: SUCCESS" },
  { timestamp: "2026-08-11T06:25:00.000Z", level: "INFO", service: "orchestrator", event: "run.completed", message: "Run hoàn thành thành công" },
  { timestamp: "2026-08-11T06:25:00.100Z", level: "WARN", service: "joint-monitor", event: "torque.warning", message: "Khớp elbow đạt 82% forcerange", attrs: { joint: "elbow", torque_nm: 6.6, limit_nm: 8 } },
  { timestamp: "2026-08-10T14:20:00.000Z", level: "ERROR", service: "safety", event: "safety.abort", message: "Dừng an toàn: lực bất thường trên khớp elbow", trace_id: "tr-f6e5d4c3b2a1", attrs: { joint: "elbow", force_n: 85, threshold_n: 50 } },
];

/* GET /runs/{id} — the timeline the detail page draws. `llm_call` carries
   model and token counts only; reasoning content is never returned or shown
   (MASTER §13.2). */
const timelineToolCalls: ToolCall[] = [
  {
    id: "tl-capture",
    tool_name: "capture_tool",
    arguments: { cameras: ["top", "wrist"] },
    status: "SUCCEEDED",
    duration_ms: 1120,
    result: {
      images: [
        { id: "tl-img-top", camera: "top", url: "/media/hero-poster.jpg" },
        { id: "tl-img-wrist", camera: "wrist", url: "/media/hero-poster.jpg" },
      ],
    },
  },
  {
    id: "tl-action",
    tool_name: "take_action",
    arguments: { instruction: "Nhặt khối lập phương đỏ và đặt vào hộp xanh" },
    status: "SUCCEEDED",
    duration_ms: 22000,
    result: { outcome: "SUCCESS" },
    episodes: [
      {
        id: "tl-ep-1",
        outcome: "SUCCESS",
        steps: 180,
        max_steps: 400,
        duration_s: 22,
        instruction: "Nhặt khối lập phương đỏ và đặt vào hộp xanh",
      },
    ],
  },
];

export type MockTimelineEntry =
  | { kind: "run_started"; at: string; source: RunSource }
  | {
      kind: "llm_call";
      at: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      duration_ms: number;
    }
  | { kind: "tool_call"; at: string; toolCall: ToolCall }
  | { kind: "run_completed"; at: string; ok: boolean; outcome: string };

export function fetchMockTimeline(runId: string): Promise<MockTimelineEntry[]> {
  const run = mockRuns.find((r) => r.id === runId);
  if (!run) return mockDelay<MockTimelineEntry[]>([], 0.02);

  const started = run.created_at;
  const entries: MockTimelineEntry[] = [
    { kind: "run_started", at: started, source: run.source },
    {
      kind: "llm_call",
      at: started,
      model: "vlm-orchestrator-1",
      input_tokens: 1204,
      output_tokens: 186,
      duration_ms: 1420,
    },
    ...timelineToolCalls.map(
      (toolCall): MockTimelineEntry => ({ kind: "tool_call", at: started, toolCall }),
    ),
    ...(run.completed_at
      ? [
          {
            kind: "run_completed" as const,
            at: run.completed_at,
            ok: run.status === "COMPLETED",
            outcome:
              run.status === "COMPLETED"
                ? "Hoàn thành"
                : run.error
                  ? run.error.message
                  : "Kết thúc không thành công",
          },
        ]
      : []),
  ];
  return mockDelay(entries, 0.02);
}

export function fetchMockRuns(): Promise<Run[]> {
  return mockDelay(mockRuns, 0.03);
}

export function fetchMockRun(id: string): Promise<Run | undefined> {
  return mockDelay(mockRuns.find((r) => r.id === id), 0.02);
}

export function fetchMockLogs(runId: string): Promise<MockLogEntry[]> {
  return mockDelay(mockLogs.filter(() => runId), 0.02);
}

export function legacyRunToSummary(run: Run): RunSummary {
  return {
    id: run.id,
    trace_id: run.trace_id,
    session_id: run.session_id,
    robot_id: run.robot_id,
    user_id: "user_mock",
    source: run.source,
    status: run.status,
    input_text: run.input_text,
    created_at: run.created_at,
    completed_at: run.completed_at,
    duration_ms: run.duration_s !== null && run.duration_s !== undefined ? run.duration_s * 1000 : null,
    error: run.error ? { ...run.error } : null,
  };
}

export function legacyRunToDetail(run: Run): RunDetail {
  return {
    ...legacyRunToSummary(run),
    final_response: run.outcome === "SUCCEEDED" ? "Hoàn thành." : null,
    outcome: run.outcome ?? null,
    events_dropped: 0,
  };
}
