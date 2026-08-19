/* mockSseStream — MASTER §19

   Nhịp thời gian cố ý gần với một lượt chạy thật: mỗi chặng của agent giữ
   1–2 giây chứ không phải vài trăm mili-giây. §19 yêu cầu mock "phát lại kịch
   bản event theo thời gian thật" — chạy quá nhanh thì không kiểm được giao diện
   có theo kịp không, mà mắt người cũng không đọc kịp.
   Replays a realistic event script in real time so the whole chain in §13.1 is
   exercised without the Cloud:
     run.started → token.delta ×N → tool.started → tool.completed
       → episode.started → episode.progress ×N → episode.completed → run.completed
   Plus a failure script: robot.disconnected → run.failed.

   The event names and payload shapes mirror P04 §8 exactly, so swapping in the
   real `fetch` + ReadableStream client means replacing this file only. */

import type {
  ConnectionStatus,
  EpisodeOutcome,
  JointState,
  MessageRun,
  RobotStatus,
  ToolStatus,
} from "@/stores";

/* ---------------------------------------------------------------- Event types */

export type SseEvent =
  | { type: "run.started"; run_id: string; input_text: string }
  | { type: "agent.status"; status: string }
  | { type: "token.delta"; message_id: string; delta: string }
  | { type: "message.completed"; message_id: string; run_metadata?: MessageRun }
  /* Suy nghĩ nội bộ của model, tách khỏi lời nói ngay từ backend
     (`server/harmony.py`). Nó KHÔNG phải một `token.delta` khác: lời nói đi vào
     bong bóng trả lời, còn suy nghĩ đi vào khối "Suy nghĩ" thu gọn — trộn hai
     dòng này là đúng cái lỗi đang thấy trên màn hình, nơi `<|channel|>thought`
     nằm giữa câu trả lời. */
  | { type: "thinking.delta"; message_id: string; delta: string }
  | { type: "thinking.completed"; message_id: string; duration_ms: number }
  | { type: "tool.started"; tool_call_id: string; tool_name: string; arguments: Record<string, unknown> }
  | { type: "tool.progress"; tool_call_id: string; progress: number }
  | { type: "tool.completed"; tool_call_id: string; status: Extract<ToolStatus, "SUCCEEDED">; result: Record<string, unknown>; duration_ms: number }
  | { type: "tool.failed"; tool_call_id: string; error: { code: string; message: string }; duration_ms: number }
  | { type: "episode.started"; episode_id: string; tool_call_id: string; instruction?: string; max_steps: number }
  | { type: "episode.progress"; episode_id: string; step: number; max_steps: number; elapsed_s: number }
  | { type: "episode.completed"; episode_id: string; outcome: EpisodeOutcome; steps: number; duration_s: number; stop_reason?: string }
  | { type: "episode.stopped"; episode_id: string }
  | { type: "robot.state.updated"; robot_status: RobotStatus; connection_status: ConnectionStatus; joints: JointState[] }
  | { type: "robot.disconnected" }
  | { type: "robot.reconnected" }
  | { type: "artifact.created"; artifact: { id: string; url: string; camera: "top" | "wrist"; captured_at: string } }
  | { type: "run.completed"; run_id: string }
  | { type: "run.failed"; run_id: string; error: { code: string; message: string } }
  | { type: "run.cancelled"; run_id: string }
  | { type: "error"; error: { code: string; message: string } }
  | { type: "ping" };

interface ScriptStep {
  /** Delay before emitting, in ms. */
  after: number;
  event: SseEvent;
}

/* ---------------------------------------------------------------- Scripts */

const AGENT_STATUSES = [
  "Đang hiểu yêu cầu",
  "Đang quan sát",
  "Đang lập kế hoạch",
  "Đang thực thi",
  "Đang kiểm tra kết quả",
];

/** Joint snapshot used by `robot.state.updated`. Moving joints run warmer. */
function jointsSnapshot(moving: boolean): JointState[] {
  const names = ["shoulder_pan", "shoulder_lift", "elbow", "wrist_1", "wrist_2", "wrist_3"];
  return names.map((name, i) => ({
    name,
    present_position: -30 + i * 25,
    present_load: moving ? 18 + i * 3 : 4,
    torque_enabled: true,
    moving,
    error_flags: [],
  }));
}

/** Vài mẩu "suy nghĩ" theo nhịp thật, để xem được khối `ThinkingBlock` mà không
    cần dựng cả Cloud Agent. Nội dung cố ý là thứ model thật hay nghĩ: nhắc lại
    yêu cầu, chọn tool, ước lượng số bước. */
function thinkingSteps(messageId: string, text: string, startAfter: number): ScriptStep[] {
  const chunks = text.match(/\S+\s*/g) ?? [text];
  return chunks.map((delta, i) => ({
    after: i === 0 ? startAfter : 38,
    event: { type: "thinking.delta", message_id: messageId, delta } as SseEvent,
  }));
}

function tokenSteps(messageId: string, text: string, startAfter: number): ScriptStep[] {
  // Split on word boundaries so the typing effect looks like real streaming.
  const chunks = text.match(/\S+\s*/g) ?? [text];
  return chunks.map((delta, i) => ({
    after: i === 0 ? startAfter : 45,
    event: { type: "token.delta", message_id: messageId, delta } as SseEvent,
  }));
}

/** The happy path: observe → plan → execute → verify. */
function successScript(runId: string, inputText: string, seed: string): ScriptStep[] {
  const msgId = `msg-agent-${seed}`;
  const captureId = `tc-capture-${seed}`;
  const stateId = `tc-state-${seed}`;
  const actionId = `tc-action-${seed}`;
  const episodeId = `ep-${seed}`;
  const maxSteps = 400;

  const progressSteps: ScriptStep[] = [];
  for (let step = 40; step <= 360; step += 40) {
    progressSteps.push({
      after: 320,
      event: {
        type: "episode.progress",
        episode_id: episodeId,
        step,
        max_steps: maxSteps,
        elapsed_s: Math.round((step / maxSteps) * 24),
      },
    });
  }

  return [
    { after: 120, event: { type: "run.started", run_id: runId, input_text: inputText } },
    // The robot is committed as soon as the run starts — this is what makes the
    // Stop button appear (§11.2).
    {
      after: 60,
      event: { type: "robot.state.updated", robot_status: "BUSY", connection_status: "ONLINE", joints: jointsSnapshot(true) },
    },
    { after: 900, event: { type: "agent.status", status: AGENT_STATUSES[0] } },

    ...thinkingSteps(
      `th-${seed}`,
      "Người dùng muốn tôi thao tác trên bàn. Trước tiên phải biết robot đang rảnh hay bận, rồi chụp ảnh xem hiện trường có gì. Nếu scene khớp với một task LIBERO thì dùng đúng mô tả của task đó, ước lượng khoảng 60 bước.",
      300,
    ),
    { after: 200, event: { type: "thinking.completed", message_id: `th-${seed}`, duration_ms: 2400 } },

    ...tokenSteps(
      msgId,
      "Tôi sẽ quan sát khu vực làm việc trước, kiểm tra trạng thái các khớp, rồi thực hiện yêu cầu của bạn.",
      420,
    ),
    { after: 200, event: { type: "message.completed", message_id: msgId } },

    // ---- Observe
    { after: 1600, event: { type: "agent.status", status: AGENT_STATUSES[1] } },
    {
      after: 150,
      event: { type: "tool.started", tool_call_id: captureId, tool_name: "capture_tool", arguments: { cameras: ["top", "wrist"] } },
    },
    {
      after: 900,
      event: {
        type: "artifact.created",
        artifact: { id: `img-top-${seed}`, url: "/media/hero-poster.jpg", camera: "top", captured_at: new Date().toISOString() },
      },
    },
    {
      after: 120,
      event: {
        type: "artifact.created",
        artifact: { id: `img-wrist-${seed}`, url: "/media/hero-poster.jpg", camera: "wrist", captured_at: new Date().toISOString() },
      },
    },
    {
      after: 100,
      event: {
        type: "tool.completed",
        tool_call_id: captureId,
        status: "SUCCEEDED",
        duration_ms: 1120,
        result: {
          images: [
            { id: `img-top-${seed}`, camera: "top", url: "/media/hero-poster.jpg" },
            { id: `img-wrist-${seed}`, camera: "wrist", url: "/media/hero-poster.jpg" },
          ],
        },
      },
    },

    // ---- Read robot state
    {
      after: 250,
      event: { type: "tool.started", tool_call_id: stateId, tool_name: "get_robot_state", arguments: {} },
    },
    {
      after: 500,
      event: {
        type: "tool.completed",
        tool_call_id: stateId,
        status: "SUCCEEDED",
        duration_ms: 480,
        result: {
          joints: [
            { name: "shoulder_pan", present_position: -12.4, present_load: 8.1, torque_enabled: true, moving: false, error_flags: [] },
            { name: "shoulder_lift", present_position: 41.8, present_load: 22.4, torque_enabled: true, moving: false, error_flags: [] },
            { name: "elbow", present_position: -63.1, present_load: 31.0, torque_enabled: true, moving: false, error_flags: [] },
            { name: "wrist_1", present_position: 5.6, present_load: 6.7, torque_enabled: true, moving: false, error_flags: [] },
            { name: "wrist_2", present_position: 88.2, present_load: 4.2, torque_enabled: true, moving: false, error_flags: [] },
            { name: "wrist_3", present_position: -4.9, present_load: 3.1, torque_enabled: true, moving: false, error_flags: [] },
          ],
        },
      },
    },

    // ---- Plan + execute
    { after: 1400, event: { type: "agent.status", status: AGENT_STATUSES[2] } },
    { after: 1200, event: { type: "agent.status", status: AGENT_STATUSES[3] } },
    {
      after: 150,
      event: { type: "tool.started", tool_call_id: actionId, tool_name: "take_action", arguments: { instruction: inputText } },
    },
    {
      after: 200,
      event: { type: "episode.started", episode_id: episodeId, tool_call_id: actionId, instruction: inputText, max_steps: maxSteps },
    },
    ...progressSteps,
    {
      after: 300,
      event: { type: "episode.completed", episode_id: episodeId, outcome: "SUCCESS", steps: 372, duration_s: 24 },
    },
    {
      after: 120,
      event: {
        type: "tool.completed",
        tool_call_id: actionId,
        status: "SUCCEEDED",
        duration_ms: 24000,
        result: { outcome: "SUCCESS", steps: 372 },
      },
    },

    // ---- Verify + wrap up
    { after: 1500, event: { type: "agent.status", status: AGENT_STATUSES[4] } },
    ...tokenSteps(`${msgId}-final`, "Đã hoàn thành yêu cầu. Bạn có thể xem ảnh trước và sau ở tab Ảnh.", 400),
    { after: 150, event: { type: "message.completed", message_id: `${msgId}-final` } },
    {
      after: 120,
      event: { type: "robot.state.updated", robot_status: "IDLE", connection_status: "ONLINE", joints: jointsSnapshot(false) },
    },
    { after: 200, event: { type: "run.completed", run_id: runId } },
  ];
}

/** The failure path: the robot drops mid-episode. Not a transient error — no auto-retry. */
function failureScript(runId: string, inputText: string, seed: string): ScriptStep[] {
  const msgId = `msg-agent-${seed}`;
  const actionId = `tc-action-${seed}`;
  const episodeId = `ep-${seed}`;

  return [
    { after: 120, event: { type: "run.started", run_id: runId, input_text: inputText } },
    {
      after: 60,
      event: { type: "robot.state.updated", robot_status: "BUSY", connection_status: "ONLINE", joints: jointsSnapshot(true) },
    },
    { after: 900, event: { type: "agent.status", status: AGENT_STATUSES[0] } },
    ...tokenSteps(msgId, "Tôi bắt đầu thực hiện yêu cầu.", 400),
    { after: 150, event: { type: "message.completed", message_id: msgId } },
    { after: 200, event: { type: "agent.status", status: AGENT_STATUSES[3] } },
    {
      after: 150,
      event: { type: "tool.started", tool_call_id: actionId, tool_name: "take_action", arguments: { instruction: inputText } },
    },
    { after: 200, event: { type: "episode.started", episode_id: episodeId, tool_call_id: actionId, instruction: inputText, max_steps: 400 } },
    { after: 400, event: { type: "episode.progress", episode_id: episodeId, step: 40, max_steps: 400, elapsed_s: 3 } },
    { after: 400, event: { type: "episode.progress", episode_id: episodeId, step: 92, max_steps: 400, elapsed_s: 7 } },
    { after: 500, event: { type: "robot.disconnected" } },
    {
      after: 60,
      event: { type: "robot.state.updated", robot_status: "DISCONNECTED", connection_status: "OFFLINE", joints: jointsSnapshot(false) },
    },
    {
      after: 200,
      event: {
        type: "episode.completed",
        episode_id: episodeId,
        outcome: "SAFETY_ABORT",
        steps: 92,
        duration_s: 8,
        stop_reason: "Mất kết nối với thiết bị Edge giữa lúc đang di chuyển.",
      },
    },
    {
      after: 150,
      event: {
        type: "tool.failed",
        tool_call_id: actionId,
        duration_ms: 8200,
        error: { code: "MCP_001", message: "Không gọi được thiết bị Edge." },
      },
    },
    { after: 200, event: { type: "run.failed", run_id: runId, error: { code: "MCP_001", message: "Không gọi được thiết bị Edge." } } },
  ];
}

/* ---------------------------------------------------------------- Runner */

export interface MockStreamHandle {
  /** Stop the replay and release every pending timer. */
  close: () => void;
}

export interface MockStreamOptions {
  runId: string;
  inputText: string;
  /** Force a scenario; otherwise picked by keyword/chance. */
  scenario?: "success" | "failure";
  onEvent: (event: SseEvent) => void;
}

/** Choose the script. Typing "lỗi" or "hỏng" forces the failure path so the
    broken-state UI is reachable on demand during review. */
function pickScenario(inputText: string, forced?: "success" | "failure") {
  if (forced) return forced;
  return /lỗi|hỏng|mất kết nối|disconnect/i.test(inputText) ? "failure" : "success";
}

/* Hệ số tốc độ phát lại kịch bản mock.
 *
 * `1` = nhịp gốc (một lượt chạy ~15.5s). Số NHỎ HƠN 1 thì chậm lại:
 * `0.5` = chậm gấp đôi, `0.25` = chậm gấp bốn. Số lớn hơn 1 thì nhanh lên,
 * tiện khi cần chạy qua nhiều lượt để kiểm giao diện.
 *
 * Có mặt vì nhịp gốc quá nhanh để theo dõi agent trace bằng mắt — vài bước
 * trôi qua chưa đầy một giây. Chỉ ảnh hưởng lớp mock, không có ý nghĩa gì khi
 * đã cắm SSE thật.
 *
 * Chặn dưới ở 0.05 để một giá trị gõ nhầm (0, số âm) không làm kịch bản đứng
 * hẳn hoặc phát ngược. */
const SPEED = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_MOCK_SPEED);
  return Number.isFinite(raw) && raw > 0 ? Math.max(raw, 0.05) : 1;
})();

export function mockSseStream({ runId, inputText, scenario, onEvent }: MockStreamOptions): MockStreamHandle {
  const seed = Date.now().toString(36).slice(-5);
  const script =
    pickScenario(inputText, scenario) === "failure"
      ? failureScript(runId, inputText, seed)
      : successScript(runId, inputText, seed);

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let i = 0;

  const tick = () => {
    if (cancelled || i >= script.length) return;
    const step = script[i++];
    timer = setTimeout(() => {
      if (cancelled) return;
      onEvent(step.event);
      tick();
    }, step.after / SPEED);
  };

  tick();

  return {
    close: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}
