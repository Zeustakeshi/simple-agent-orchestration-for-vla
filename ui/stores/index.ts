import { create } from "zustand";

export type RobotStatus = "IDLE" | "BUSY" | "STOPPING" | "ERROR" | "DISCONNECTED";
export type ConnectionStatus = "UNREGISTERED" | "ONLINE" | "OFFLINE";

export type AgentStatusLabel =
  | "Đang hiểu yêu cầu"
  | "Đang quan sát"
  | "Đang lập kế hoạch"
  | "Đang thực thi"
  | "Đang kiểm tra kết quả"
  | "Đang xử lý";

export type EpisodeOutcome =
  | "SUCCESS"
  | "STOPPED"
  | "TIMEOUT"
  | "MAX_STEPS"
  | "SAFETY_ABORT";

export type ToolStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT";

export type RunSource = "CHAT" | "SCHEDULE" | "MANUAL_RUN";
/* `SCHEDULED` = lịch đã tới giờ nhưng run chưa khởi động. Nó khác `RUNNING`
   ở chỗ chưa có gì đang chạy, nên trang Nhật ký phải phân biệt được.
   `TIMEOUT` đến từ develop: run bị cắt vì quá giờ. */
export type RunStatus =
  | "RUNNING"
  | "WAITING_TOOL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT"
  | "SCHEDULED";

export interface MessageRun {
  id: string;
  trace_id: string;
  status: RunStatus;
  duration_ms: number | null;
}

/* ----------------------------------------------------------------
   Robot
   ---------------------------------------------------------------- */
export interface Robot {
  id: string;
  name: string;
  model: string;
  robot_status: RobotStatus;
  connection_status: ConnectionStatus;
  edge_version: string;
  health: {
    has_error: boolean;
    error_flags: string[];
  };
  capabilities: { name: string; version: string }[];
  joints: JointState[];
  /** Pose đầu công tác. Vắng mặt nếu backend chưa phơi ra — khi đó ẩn khối. */
  end_effector?: EndEffectorState;
  /** Thời gian mô phỏng, giây. Chỉ có khi robot chạy trong MuJoCo. */
  sim_time?: number;
}

/* Trạng thái một khớp của cánh tay.

   Chia làm hai nhóm, cố ý không trộn:

   · Nhóm động lực học — tương ứng các đại lượng MuJoCo phơi ra cho mỗi khớp:
     `qpos` (góc), `qvel` (vận tốc góc), `ctrl` (lệnh đặt cho actuator),
     lực khớp, và dải giới hạn `range`. Sai số giữa `ctrl` và `qpos` là thứ
     nói lên bộ điều khiển đang bám kịp hay không.

   Cánh tay này KHÔNG có cảm biến nhiệt, nên không có `present_temperature`.
   Vai trò "đại lượng cho biết khớp có đang bị ép quá không" — thứ mà Telemetry
   Rail §12.4 và các ngưỡng DOC 0 §3.5.2 vốn dựng trên nhiệt độ — nay do mô-men
   so với `forcerange` đảm nhiệm. Trường nào backend không trả thì ẩn phần tử đi
   chứ không hiện N/A (§13.3). */
export interface JointState {
  name: string;
  /** qpos — góc hiện tại, độ */
  present_position: number;
  /** qvel — vận tốc góc, độ/giây */
  present_velocity?: number;
  /** ctrl — góc mà bộ điều khiển đang yêu cầu, độ */
  target_position?: number;
  /** Lực sinh ra ở khớp, N·m */
  torque_nm?: number;
  /** Mô-men tối đa của actuator — `forcerange` trong MJCF. Dùng làm mẫu số
      để biết khớp đang gánh bao nhiêu phần trăm sức của nó. */
  torque_limit_nm?: number;
  /** Giới hạn khớp, độ. Thiếu thì thanh trượt lùi về ±180 */
  range_min?: number;
  range_max?: number;

  present_load: number;
  torque_enabled: boolean;
  moving: boolean;
  error_flags: string[];
}

/** Pose đầu công tác — MuJoCo cho qua `xpos`/`xquat` của site cuối chuỗi. */
export interface EndEffectorState {
  /** xpos, mét, trong hệ toạ độ gốc của cánh tay */
  position: { x: number; y: number; z: number };
  /** Quy từ xquat sang góc Euler, độ */
  orientation: { roll: number; pitch: number; yaw: number };
  /** Độ mở kẹp, 0 = đóng hẳn, 1 = mở hết */
  gripper?: number;
}

/* ----------------------------------------------------------------
   Session
   ---------------------------------------------------------------- */
export interface Session {
  id: string;
  title: string;
  robot_id: string;
  created_at: string;
  updated_at: string;
  active_run: string | null;
  last_message_preview: string | null;
  /** Ghim lên đầu danh sách. Đây là dữ liệu của người dùng, không phải tuỳ chọn
      giao diện — nên nó nằm ở backend chứ không phải `localStorage` (§18.2):
      đổi máy hay đổi trình duyệt thì các phiên đã ghim vẫn phải còn. */
  pinned: boolean;
}

/* ----------------------------------------------------------------
   Message
   ---------------------------------------------------------------- */
export interface Message {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  tool_calls?: ToolCall[];
  /** Suy nghĩ nội bộ của model trong lượt này, đã tách khỏi lời nói ở backend
      (`server/harmony.py`). Hiện thành khối "Suy nghĩ" THU GỌN phía trên câu
      trả lời — người dùng mở ra khi muốn hiểu vì sao agent làm vậy, còn mặc
      định thì không phải đọc.

      §13.2 cấm hiện chain-of-thought như thể nó là LỜI CỦA AGENT, và điều đó
      vẫn giữ: khối này được dán nhãn rõ là suy nghĩ, đóng sẵn, và không bao giờ
      thay câu trả lời. Trước đây model harmony đổ nguyên nó vào bong bóng kèm
      cả `<|channel|>` — vừa vi phạm §13.2 vừa đọc như lỗi hiển thị. */
  thinking?: string;
  /** Tổng thời gian agent dừng lại nghĩ trong lượt này, tính bằng ms. Cộng dồn
      qua các đoạn — nói "đã suy nghĩ 12s" thì đó phải là toàn bộ thời gian
      nghĩ, không phải riêng đoạn cuối. */
  thinking_ms?: number;
  /** Chặng đường agent đã đi để ra được câu trả lời này. Gắn vào tin nhắn khi
      lượt chạy kết thúc, giống cách tool_calls được gắn — nhờ vậy cuộn lại vẫn
      xem được, và mỗi lượt giữ chặng của riêng nó. */
  agent_steps?: AgentStep[];
  send_status?: "sending" | "sent" | "failed";
  run?: MessageRun;
}

export interface ToolCall {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: ToolStatus;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  duration_ms?: number;
  episodes?: Episode[];
  /** Mốc client NHẬN được `tool.started`, không phải trường từ backend.

      Dùng để xếp tool xen kẽ đúng thứ tự với các bước giai đoạn trong agent
      trace — `ToolCall` vốn không mang mốc bắt đầu nào, chỉ có `duration_ms`
      sau khi xong. Cùng cơ sở đo với `AgentStep.startedAt`.

      Chỉ dùng cho THỨ TỰ và số đếm tương đối. Không bao giờ hiện thành giờ
      tuyệt đối, và khi tool đã xong thì luôn ưu tiên `duration_ms` của backend
      thay vì hiệu số đo ở client. */
  started_at?: number;
}

export interface Episode {
  id: string;
  /** Absent while the episode is still running — set by `episode.completed`. */
  outcome?: EpisodeOutcome;
  steps: number;
  max_steps: number;
  duration_s: number;
  /** The instruction the robot is executing, when the backend reports one. */
  instruction?: string;
  stop_reason?: string;
  video_artifact_id?: string;
}

/* ----------------------------------------------------------------
   Run
   ---------------------------------------------------------------- */
export interface Run {
  id: string;
  session_id: string;
  robot_id: string;
  status: RunStatus;
  source: RunSource;
  /** Có khi `source = SCHEDULE` — cho phép nhảy ngược về lịch đã tạo ra run.
      Hai nhánh cùng thêm trường này ở hai vị trí khác nhau nên git gộp ra hai
      dòng trùng tên; giữ lại bản có mô tả. */
  schedule_id?: string | null;
  input_text: string;
  created_at: string;
  completed_at: string | null;
  duration_s: number | null;
  trace_id: string;
  outcome?: string;
  error?: { code: string; message: string };
  episodes: Episode[];
}

/* ----------------------------------------------------------------
   Schedule
   ---------------------------------------------------------------- */
export interface Schedule {
  id: string;
  name: string;
  description: string;
  robot_id: string;
  task_prompt: string;
  cron_expression: string;
  cron_description: string;
  timezone: string;
  enabled: boolean;
  overlap_policy: "SKIP" | "QUEUE" | "FORCE_STOP";
  max_duration_s: number;
  consecutive_failures: number;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ----------------------------------------------------------------
   Auth Store
   ---------------------------------------------------------------- */
export interface User {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  timezone: string;
}

interface AuthStore {
  user: User | null;
  selectedRobotId: string | null;
  setUser: (user: User | null) => void;
  selectRobot: (id: string | null) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  selectedRobotId: null,
  setUser: (user) => set({ user }),
  selectRobot: (id) => set({ selectedRobotId: id }),
}));

/* ----------------------------------------------------------------
   UI Preference Store — localStorage only for UI prefs (MASTER §18.2)
   ---------------------------------------------------------------- */
export type CameraLayout = "both" | "top" | "wrist";
export type ArtifactTab = "camera" | "state";
/** What the user picked. "system" follows prefers-color-scheme. */
export type ThemePreference = "system" | "dark" | "light";
/** What the DOM actually gets stamped with. */
export type ResolvedTheme = "dark" | "light";

interface UiPreferenceStore {
  theme: ThemePreference;
  controlSplitRatio: number;
  cameraLayout: CameraLayout;
  /** top-first or wrist-first when both cameras are shown (P05) */
  cameraWristFirst: boolean;
  sidebarCollapsed: boolean;
  /** Bề rộng sidebar lúc MỞ RỘNG, tính bằng px. Lúc thu gọn thì dải 64px là cố
      định — kéo rộng một cột chỉ có icon thì không để làm gì. */
  sidebarWidth: number;
  /** Which artifact tab the control page shows — lets "Xem camera" switch tabs
      without navigating (P04 §5). */
  artifactTab: ArtifactTab;
  setTheme: (theme: ThemePreference) => void;
  setSplitRatio: (ratio: number) => void;
  setCameraLayout: (layout: CameraLayout) => void;
  toggleCameraOrder: () => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;
  setArtifactTab: (tab: ArtifactTab) => void;
}

/* Giới hạn bề rộng sidebar.
 *
 * MIN 200px: dưới mức này nhãn dài nhất ("Lịch sử phiên", 13px medium) bắt đầu
 * bị `truncate` cắt, mà một mục nav bị cắt chữ thì thà thu gọn hẳn về icon.
 * MAX 400px: sidebar rộng hơn nữa thì cột nội dung phải thu lại, trong khi
 * chẳng có gì trong sidebar dùng tới chỗ đó — nav item dài nhất chỉ ~150px.
 * DEFAULT 240px giữ đúng `w-60` cũ, nên người chưa từng kéo không thấy gì đổi. */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 400;
export const SIDEBAR_DEFAULT_WIDTH = 240;

export function clampSidebarWidth(px: number): number {
  return Math.min(Math.max(px, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

/* localStorage holds UI preferences only — never business data or tokens
   (MASTER §18.2). */
const LS_KEYS = {
  theme: "ui.theme",
  split: "ui.control.split",
  cameraLayout: "ui.camera.layout",
  cameraOrder: "ui.camera.wristFirst",
  sidebar: "ui.sidebar.collapsed",
  sidebarWidth: "ui.sidebar.width",
} as const;

function readLocal<T>(key: string, parse: (raw: string) => T, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — preferences are non-essential */
  }
}

export const useUiPreferenceStore = create<UiPreferenceStore>((set, get) => ({
  theme: "dark",
  controlSplitRatio: 0.6,
  cameraLayout: "both",
  cameraWristFirst: false,
  sidebarCollapsed: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  artifactTab: "camera",
  setTheme: (theme) => {
    set({ theme });
    writeLocal(LS_KEYS.theme, theme);
    applyTheme(theme);
  },
  setSplitRatio: (ratio) => {
    set({ controlSplitRatio: ratio });
    writeLocal(LS_KEYS.split, String(ratio));
  },
  setCameraLayout: (layout) => {
    set({ cameraLayout: layout });
    writeLocal(LS_KEYS.cameraLayout, layout);
  },
  toggleCameraOrder: () => {
    const next = !get().cameraWristFirst;
    set({ cameraWristFirst: next });
    writeLocal(LS_KEYS.cameraOrder, String(next));
  },
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    writeLocal(LS_KEYS.sidebar, String(next));
  },
  /* Kẹp NGAY tại store chứ không tin chỗ gọi: giá trị này còn đến từ
     localStorage, mà localStorage thì người dùng sửa tay được. */
  setSidebarWidth: (px) => {
    const width = clampSidebarWidth(px);
    set({ sidebarWidth: width });
    writeLocal(LS_KEYS.sidebarWidth, String(Math.round(width)));
  },
  setArtifactTab: (artifactTab) => set({ artifactTab }),
}));

/* ---- theme plumbing ------------------------------------------------
   The store holds the *preference*; the DOM always carries a resolved value,
   so CSS never has to know about "system". */

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Stamp the resolved theme onto <html>. Safe to call before React mounts. */
export function applyTheme(preference: ThemePreference) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(preference);
}

export function readStoredTheme(): ThemePreference {
  return readLocal(
    LS_KEYS.theme,
    (raw) => (raw === "light" || raw === "dark" || raw === "system" ? raw : "dark"),
    "dark",
  );
}

/** Hydrate preferences from localStorage after mount — keeps SSR output stable. */
export function hydrateUiPreferences() {
  useUiPreferenceStore.setState({
    theme: readStoredTheme(),
    controlSplitRatio: readLocal(LS_KEYS.split, (r) => {
      const n = parseFloat(r);
      return Number.isFinite(n) ? Math.min(Math.max(n, 0.3), 0.7) : 0.6;
    }, 0.6),
    cameraLayout: readLocal(LS_KEYS.cameraLayout, (r) => (r === "top" || r === "wrist" ? r : "both"), "both"),
    cameraWristFirst: readLocal(LS_KEYS.cameraOrder, (r) => r === "true", false),
    /* Chưa từng chọn thì lấy theo bề rộng màn hình: <1280px mặc định thu gọn,
       đúng tinh thần MASTER §17. Đã chọn rồi thì tôn trọng lựa chọn đó. */
    sidebarCollapsed: readLocal(
      LS_KEYS.sidebar,
      (r) => r === "true",
      typeof window !== "undefined" && !window.matchMedia("(min-width: 1280px)").matches,
    ),
    sidebarWidth: readLocal(
      LS_KEYS.sidebarWidth,
      (r) => {
        const n = parseFloat(r);
        return Number.isFinite(n) ? clampSidebarWidth(n) : SIDEBAR_DEFAULT_WIDTH;
      },
      SIDEBAR_DEFAULT_WIDTH,
    ),
  });
}

/* ----------------------------------------------------------------
   Toast Store — MASTER §14.3 row 1 / §14.4
   Non-blocking errors and confirmations only. Anything tied to the button
   the user just pressed goes inline instead.
   ---------------------------------------------------------------- */
export interface Toast {
  id: string;
  tone: "success" | "error" | "info";
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (tone: Toast["tone"], message: string) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (tone, message) =>
    set((s) => ({
      toasts: [...s.toasts, { id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, tone, message }],
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helper so components don't need the hook inside callbacks. */
export const toast = {
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message),
  info: (message: string) => useToastStore.getState().push("info", message),
};

/* ----------------------------------------------------------------
   Realtime Store — SSE events per session (MASTER §18.2)
   ---------------------------------------------------------------- */
export interface ToolCardState {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: ToolStatus;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
  duration_ms?: number;
  progress?: number;
}

export interface EpisodeProgressState {
  id: string;
  step: number;
  max_steps: number;
  instruction?: string;
  outcome?: EpisodeOutcome;
  stop_reason?: string;
  duration_s: number;
}

/** Một bước agent đã đi qua trong lượt chạy hiện tại.

    Đây là *tiến trình user-facing*, không phải suy luận nội bộ: nhãn lấy nguyên
    từ tập đóng của §13.2, thời lượng do client đo giữa hai sự kiện. §13.2 vẫn
    cấm hiện chain-of-thought — khối này nói agent ĐANG LÀM GÌ, không nói nó
    đang nghĩ gì. */
export interface AgentStep {
  id: string;
  label: AgentStatusLabel;
  startedAt: number;
  endedAt?: number;
}

/** Artifact image emitted by `artifact.created` — P04 §7 "Ảnh" tab. */
export interface ImageRef {
  id: string;
  url: string;
  camera: "top" | "wrist";
  captured_at: string;
  description?: string;
}

/** Transient banner above the composer (episode.stopped, robot.disconnected, run.failed). */
export interface ControlBanner {
  tone: "info" | "warning" | "error";
  message: string;
  /** Error code for i18n lookup — set for run.failed. */
  code?: string;
  /** Text to refill the composer with when the user presses "Thử lại". */
  retryInput?: string;
}

interface RealtimeStore {
  sessionId: string | null;
  connectionState: "connecting" | "connected" | "reconnecting" | "disconnected";
  streamingMessage: { id: string; content: string } | null;
  /** Suy nghĩ đang chảy về của lượt hiện tại. Cùng `id` với `streamingMessage`
      khi cả hai thuộc một tin nhắn. */
  streamingThought: { id: string; content: string } | null;
  toolCards: Map<string, ToolCardState>;
  episodeProgress: EpisodeProgressState | null;
  robotState: {
    robot_status: RobotStatus;
    connection_status: ConnectionStatus;
    joints: JointState[];
  } | null;
  agentStatus: AgentStatusLabel | null;
  agentSteps: AgentStep[];
  sseLastEventTime: number | null;
  robotDisconnected: boolean;
  composerLocked: boolean;
  images: ImageRef[];
  banner: ControlBanner | null;
  runId: string | null;
  /** Bong bóng assistant mà lượt chạy hiện tại gắn vào.

      Trước đây cả tool call lẫn agent step đều tìm "assistant message cuối
      cùng" tại thời điểm gọi. Kịch bản thật phát narration → tool → narration,
      nên tool rơi vào bong bóng thứ nhất còn step rơi vào bong bóng thứ hai —
      trace bị xé làm đôi. Neo theo id thì cả hai về cùng một chỗ.

      `null` = lượt này chưa sinh ra bong bóng nào. */
  runAnchorMessageId: string | null;

  /** Closes the live event stream. Registered by useSessionStream so that a
      stop command can end the run wherever the button was pressed. */
  closeStream: (() => void) | null;

  addImage: (image: ImageRef) => void;
  setBanner: (banner: ControlBanner | null) => void;
  setRunId: (runId: string | null) => void;
  setRunAnchorMessageId: (id: string | null) => void;
  setCloseStream: (close: (() => void) | null) => void;
  setSessionId: (id: string | null) => void;
  setConnectionState: (state: RealtimeStore["connectionState"]) => void;
  appendStreamingContent: (id: string, delta: string) => void;
  appendStreamingThought: (id: string, delta: string) => void;
  finalizeMessage: () => void;
  finalizeThought: () => void;
  setAgentStatus: (status: AgentStatusLabel | null) => void;
  /** Đóng bước đang mở rồi mở bước mới. Gọi từ `agent.status`. */
  pushAgentStep: (label: AgentStatusLabel) => void;
  /** Đóng bước cuối khi lượt chạy kết thúc. */
  closeAgentSteps: () => void;
  /** Dọn sạch khi mở lượt chạy mới. */
  resetAgentSteps: () => void;
  addToolCard: (card: ToolCardState) => void;
  updateToolCard: (id: string, update: Partial<ToolCardState>) => void;
  setEpisodeProgress: (progress: EpisodeProgressState | null) => void;
  updateRobotState: (state: RealtimeStore["robotState"]) => void;
  lockComposer: () => void;
  unlockComposer: () => void;
  setRobotDisconnected: (v: boolean) => void;
  reset: () => void;
}

export const useRealtimeStore = create<RealtimeStore>((set) => ({
  sessionId: null,
  connectionState: "disconnected",
  streamingMessage: null,
  streamingThought: null,
  toolCards: new Map(),
  episodeProgress: null,
  robotState: null,
  agentStatus: null,
  agentSteps: [],
  sseLastEventTime: null,
  robotDisconnected: false,
  composerLocked: false,
  images: [],
  banner: null,
  runId: null,
  runAnchorMessageId: null,
  closeStream: null,

  setCloseStream: (closeStream) => set({ closeStream }),
  addImage: (image) =>
    set((s) => ({ images: [image, ...s.images], sseLastEventTime: Date.now() })),
  setBanner: (banner) => set({ banner }),
  setRunId: (runId) => set({ runId }),
  setRunAnchorMessageId: (runAnchorMessageId) => set({ runAnchorMessageId }),
  setSessionId: (id) => set({ sessionId: id }),
  setConnectionState: (connectionState) => set({ connectionState }),
  appendStreamingContent: (id, delta) =>
    set((s) => ({
      streamingMessage: {
        id,
        content: (s.streamingMessage?.id === id ? s.streamingMessage.content : "") + delta,
      },
      sseLastEventTime: Date.now(),
    })),
  appendStreamingThought: (id, delta) =>
    set((s) => ({
      streamingThought: {
        id,
        content: (s.streamingThought?.id === id ? s.streamingThought.content : "") + delta,
      },
      sseLastEventTime: Date.now(),
    })),
  finalizeMessage: () => set({ streamingMessage: null }),
  finalizeThought: () => set({ streamingThought: null }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  pushAgentStep: (label) =>
    set((s) => {
      const last = s.agentSteps[s.agentSteps.length - 1];

      /* Cùng nhãn với bước ĐANG MỞ thì vẫn là bước đó — không mở dòng mới, và
         cũng KHÔNG đóng nó lại.

         Bản trước đóng bước rồi mới so sánh, và so bằng `last.endedAt === now`.
         Hệ quả: lần phát lại thứ nhất đóng bước đó lại, lần thứ hai thấy bước
         đã đóng nên điều kiện sai và mở một dòng TRÙNG. Backend thật phát cùng
         một `stage` nhiều lần liên tiếp (mỗi `episode.progress` một lần), nên
         trace ra bốn dòng "Đang thực thi" liền nhau. Với mock thì không lộ vì
         mỗi nhãn chỉ phát đúng một lần. */
      if (last && last.label === label && last.endedAt === undefined) return s;

      const now = Date.now();
      const steps = s.agentSteps.map((step, i) =>
        i === s.agentSteps.length - 1 && step.endedAt === undefined ? { ...step, endedAt: now } : step,
      );
      return {
        agentSteps: [...steps, { id: `step-${now}-${steps.length}`, label, startedAt: now }],
      };
    }),
  resetAgentSteps: () => set({ agentSteps: [] }),
  closeAgentSteps: () =>
    set((s) => ({
      agentSteps: s.agentSteps.map((step, i) =>
        i === s.agentSteps.length - 1 && step.endedAt === undefined
          ? { ...step, endedAt: Date.now() }
          : step,
      ),
    })),
  addToolCard: (card) =>
    set((s) => {
      const next = new Map(s.toolCards);
      next.set(card.id, card);
      return { toolCards: next, sseLastEventTime: Date.now() };
    }),
  updateToolCard: (id, update) =>
    set((s) => {
      const next = new Map(s.toolCards);
      const existing = next.get(id);
      if (existing) next.set(id, { ...existing, ...update });
      return { toolCards: next, sseLastEventTime: Date.now() };
    }),
  setEpisodeProgress: (episodeProgress) => set({ episodeProgress, sseLastEventTime: Date.now() }),
  updateRobotState: (robotState) => set({ robotState, sseLastEventTime: Date.now() }),
  lockComposer: () => set({ composerLocked: true }),
  unlockComposer: () => set({ composerLocked: false }),
  setRobotDisconnected: (v) => set({ robotDisconnected: v }),
  reset: () =>
    set({
      sessionId: null,
      connectionState: "disconnected",
      streamingMessage: null,
      streamingThought: null,
      toolCards: new Map(),
      episodeProgress: null,
      robotState: null,
      agentStatus: null,
      agentSteps: [],
      sseLastEventTime: null,
      robotDisconnected: false,
      composerLocked: false,
      images: [],
      banner: null,
      runId: null,
      runAnchorMessageId: null,
      closeStream: null,
    }),
}));
