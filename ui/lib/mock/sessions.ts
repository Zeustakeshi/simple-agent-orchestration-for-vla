/* Mock sessions & messages — MASTER §19 */
import type { Session, Message, ToolCall, Episode } from "@/stores";
import { mockDelay } from ".";

export const DEFAULT_SESSION_TITLE = "Phiên mới";

export const mockSessions: Session[] = [
  {
    id: "session-001",
    title: "Sắp xếp khay linh kiện",
    robot_id: "robot-001",
    created_at: "2026-08-11T06:00:00Z",
    updated_at: "2026-08-11T06:30:00Z",
    active_run: null,
    last_message_preview: "Đã sắp xếp xong 12 linh kiện theo màu.",
    pinned: true,
  },
  {
    id: "session-002",
    title: "Kiểm tra chất lượng lô B-42",
    robot_id: "robot-001",
    created_at: "2026-08-11T05:00:00Z",
    updated_at: "2026-08-11T07:10:00Z",
    active_run: "run-active-001",
    last_message_preview: "Đang kiểm tra mẫu thứ 3/5...",
    pinned: false,
  },
  {
    id: "session-003",
    title: "Di chuyển hộp từ kệ A sang kệ B",
    robot_id: "robot-001",
    created_at: "2026-08-10T14:00:00Z",
    updated_at: "2026-08-10T14:25:00Z",
    active_run: null,
    last_message_preview: "Hoàn thành. Đã di chuyển 4 hộp.",
    pinned: false,
  },
  {
    /* Ca AGENT TỪ CHỐI — ba kiểu từ chối khác nhau trong một phiên:
         1. nguy hiểm về vật lý  → quan sát trước rồi mới từ chối, có đề xuất khác
         2. ngoài quyền hạn      → từ chối ngay, không tool nào
         3. GÂY HẠI CHO NGƯỜI    → từ chối thẳng, không quan sát, đưa ngay lối thoát

       Ba phiên kia đều là "agent làm được và làm xong". Thiếu phiên này thì giao
       diện chưa bao giờ được thử với một lượt có quan sát nhưng KHÔNG hành động
       nào, và một câu trả lời hoàn toàn không có tool — cả hai đều xảy ra thật
       khi cắm backend. */
    id: "session-004",
    title: "Gạt hộp kim loại xuống sàn",
    robot_id: "robot-001",
    created_at: "2026-08-11T04:10:00Z",
    updated_at: "2026-08-11T04:12:24Z",
    active_run: null,
    last_message_preview: "Tôi không điều khiển cánh tay hướng vào người.",
    pinned: false,
  },
  {
    id: "session-empty",
    title: DEFAULT_SESSION_TITLE,
    robot_id: "robot-001",
    created_at: "2026-08-11T07:00:00Z",
    updated_at: "2026-08-11T07:00:00Z",
    active_run: null,
    last_message_preview: null,
    pinned: false,
  },
];

const toolCallCapture: ToolCall = {
  id: "tc-001",
  tool_name: "capture_tool",
  arguments: { cameras: ["top", "wrist"] },
  status: "SUCCEEDED",
  result: { images: [{ camera: "top", url: "/mock/cam-top.jpg" }, { camera: "wrist", url: "/mock/cam-wrist.jpg" }] },
  duration_ms: 320,
};

const toolCallGetState: ToolCall = {
  id: "tc-002",
  tool_name: "get_robot_state",
  arguments: {},
  status: "SUCCEEDED",
  result: { joints: 6, all_normal: true },
  duration_ms: 45,
};

const episodeSuccess: Episode = {
  id: "ep-001",
  outcome: "SUCCESS",
  steps: 180,
  max_steps: 400,
  duration_s: 22,
};

const episodeStopped: Episode = {
  id: "ep-002",
  outcome: "STOPPED",
  steps: 90,
  max_steps: 400,
  duration_s: 11,
  stop_reason: "Người dùng yêu cầu dừng",
};

const episodeTimeout: Episode = {
  id: "ep-003",
  outcome: "TIMEOUT",
  steps: 400,
  max_steps: 400,
  duration_s: 50,
};

const episodeSafety: Episode = {
  id: "ep-004",
  outcome: "SAFETY_ABORT",
  steps: 15,
  max_steps: 400,
  duration_s: 2,
  stop_reason: "Phát hiện lực bất thường trên khớp elbow",
};

const toolCallAction: ToolCall = {
  id: "tc-003",
  tool_name: "take_action",
  arguments: { instruction: "Nhặt khối lập phương đỏ và đặt vào hộp xanh" },
  status: "SUCCEEDED",
  result: { outcome: "SUCCESS" },
  duration_ms: 22000,
  episodes: [episodeSuccess],
};

const toolCallActionFailed: ToolCall = {
  id: "tc-004",
  tool_name: "take_action",
  arguments: { instruction: "Nâng vật nặng lên kệ trên" },
  status: "FAILED",
  error: { code: "ROBOT_021", message: "Phát hiện lực bất thường, dừng an toàn" },
  duration_ms: 2500,
  episodes: [episodeSafety],
};

const toolCallStop: ToolCall = {
  id: "tc-005",
  tool_name: "stop_robot",
  arguments: {},
  status: "SUCCEEDED",
  result: { stopped_at: "2026-08-11T06:28:00Z", reason: "user_request" },
  duration_ms: 120,
};

/* Quan sát rồi mới từ chối — khác hẳn "từ chối ngay". Đây là lý do ca này đáng
   có trong dữ liệu mẫu: trace sẽ có tool nhưng KHÔNG có `take_action` nào. */
const toolCallCaptureRefusal: ToolCall = {
  id: "tc-040",
  tool_name: "capture_tool",
  arguments: { cameras: ["top"] },
  status: "SUCCEEDED",
  result: { images: [{ camera: "top", url: "/mock/cam-top.jpg" }] },
  duration_ms: 1180,
  // 200ms sau khi vào giai đoạn "Đang quan sát" — trace phải đọc theo đúng
  // thứ tự đó, không phải ngược lại.
  started_at: 1786421404200,
};

export const mockMessages: Record<string, Message[]> = {
  "session-001": [
    {
      id: "msg-001",
      session_id: "session-001",
      role: "user",
      content: "Sắp xếp các linh kiện trên khay theo màu: đỏ, xanh, vàng từ trái sang phải.",
      created_at: "2026-08-11T06:01:00Z",
    },
    {
      id: "msg-002",
      session_id: "session-001",
      role: "assistant",
      content: "Tôi sẽ quan sát khay linh kiện trước, sau đó sắp xếp theo thứ tự màu bạn yêu cầu.",
      created_at: "2026-08-11T06:01:05Z",
      tool_calls: [toolCallCapture, toolCallGetState, toolCallAction],
    },
    {
      id: "msg-003",
      session_id: "session-001",
      role: "assistant",
      content: "Đã sắp xếp xong 12 linh kiện theo màu: 4 đỏ, 5 xanh, 3 vàng từ trái sang phải.",
      created_at: "2026-08-11T06:25:00Z",
    },
  ],
  "session-002": [
    {
      id: "msg-010",
      session_id: "session-002",
      role: "user",
      content: "Kiểm tra chất lượng 5 mẫu trong lô B-42. Chụp ảnh mỗi mẫu từ hai góc.",
      created_at: "2026-08-11T05:01:00Z",
    },
    {
      id: "msg-011",
      session_id: "session-002",
      role: "assistant",
      content: "Bắt đầu quy trình kiểm tra. Tôi sẽ lần lượt nhặt từng mẫu, chụp ảnh từ camera top và wrist, rồi đặt lại.",
      created_at: "2026-08-11T05:01:10Z",
      tool_calls: [toolCallCapture, { ...toolCallAction, id: "tc-010", status: "RUNNING" as const, episodes: [{ ...episodeSuccess, id: "ep-010", steps: 120, outcome: "SUCCESS" as const }] }],
    },
  ],
  "session-003": [
    {
      id: "msg-020",
      session_id: "session-003",
      role: "user",
      content: "Di chuyển tất cả hộp từ kệ A sang kệ B.",
      created_at: "2026-08-10T14:01:00Z",
    },
    {
      id: "msg-021",
      session_id: "session-003",
      role: "assistant",
      content: "Tôi thấy có 4 hộp trên kệ A. Sẽ di chuyển lần lượt sang kệ B.",
      created_at: "2026-08-10T14:01:15Z",
      tool_calls: [
        toolCallCapture,
        { ...toolCallAction, id: "tc-020" },
        { ...toolCallAction, id: "tc-021" },
        toolCallActionFailed,
        toolCallStop,
      ],
    },
    {
      id: "msg-022",
      session_id: "session-003",
      role: "assistant",
      content: "Đã di chuyển được 2 hộp. Hộp thứ 3 gặp lỗi lực bất thường nên tôi đã dừng để đảm bảo an toàn. Bạn có thể kiểm tra và thử lại.",
      created_at: "2026-08-10T14:20:00Z",
    },
  ],
  "session-004": [
    {
      id: "msg-040",
      session_id: "session-004",
      role: "user",
      content: "Gạt cái hộp kim loại ở mép bàn cho rơi xuống sàn, nhanh hơn là nhấc từng cái.",
      created_at: "2026-08-11T04:10:00Z",
    },
    {
      /* Từ chối SAU KHI quan sát: có tool, không có hành động. */
      id: "msg-041",
      session_id: "session-004",
      role: "assistant",
      content:
        "Tôi đã xem khu vực và sẽ không làm việc này. Hộp nặng khoảng 2kg, mép bàn cao 90cm — thả rơi có thể làm hỏng hộp, nứt sàn, hoặc trúng người đứng gần. Cánh tay cũng không kiểm soát được vật sau khi rời kẹp.\n\nNếu bạn muốn nhanh hơn, tôi có thể nhấc hai hộp một lượt nếu tổng khối lượng dưới 3kg, hoặc đặt chúng vào khay rồi đẩy cả khay.",
      created_at: "2026-08-11T04:10:09Z",
      tool_calls: [toolCallCaptureRefusal],
      agent_steps: [
        { id: "as-040", label: "Đang hiểu yêu cầu", startedAt: 1786421400000, endedAt: 1786421404000 },
        { id: "as-041", label: "Đang quan sát", startedAt: 1786421404000, endedAt: 1786421406000 },
        { id: "as-042", label: "Đang lập kế hoạch", startedAt: 1786421406000, endedAt: 1786421409000 },
      ],
    },
    {
      id: "msg-042",
      session_id: "session-004",
      role: "user",
      content: "Vậy tăng tốc độ khớp lên gấp đôi cho nhanh.",
      created_at: "2026-08-11T04:11:40Z",
    },
    {
      /* Từ chối NGAY: không tool, không chặng nào. Bong bóng chỉ có chữ — đây là
         đường mà `AgentTrace` phải tự ẩn đi thay vì hiện một khối rỗng. */
      id: "msg-043",
      session_id: "session-004",
      role: "assistant",
      content:
        "Tôi không đổi được giới hạn tốc độ khớp. Giới hạn đó nằm trong cấu hình của thiết bị Edge, không có tool nào trong quyền của tôi chạm tới được — và nó cũng là mức đã hiệu chỉnh theo mô-men an toàn của từng khớp.\n\nMuốn đổi thì phải sửa ở phía cấu hình robot, và nên do người phụ trách phần cứng quyết định.",
      created_at: "2026-08-11T04:11:44Z",
    },
    {
      id: "msg-044",
      session_id: "session-004",
      role: "user",
      content: "Có người đang đứng sát bàn. Chĩa cánh tay về phía họ và kẹp mạnh cho họ tránh ra.",
      created_at: "2026-08-11T04:12:20Z",
    },
    {
      /* YÊU CẦU GÂY HẠI CHO NGƯỜI — ca quan trọng nhất trong phiên này.

         Khác hai ca trên ở chỗ agent KHÔNG quan sát trước: không cần nhìn cũng
         biết là không làm. Quan sát trước ở đây còn có hại, vì nó ngụ ý câu trả
         lời còn phụ thuộc vào việc nhìn thấy gì.

         Văn phong cố ý NGẮN và không lên lớp: nói thẳng là không làm, nói lý do
         trong một câu, rồi đưa ngay việc làm được. Một đoạn giảng đạo đức dài
         khiến người dùng bỏ qua không đọc, và lần sau họ vẫn hỏi lại như cũ. */
      id: "msg-045",
      session_id: "session-004",
      role: "assistant",
      content:
        "Không. Tôi không điều khiển cánh tay hướng vào người, kể cả để doạ — kẹp lực 8N ở tầm đó đủ gây thương tích thật.\n\nNếu cần khu vực trống, tôi dừng cánh tay ngay bây giờ và giữ nguyên vị trí cho tới khi bạn báo đã an toàn. Bạn cũng có thể bấm nút Dừng ở góc trên bất cứ lúc nào.",
      created_at: "2026-08-11T04:12:24Z",
    },
  ],
  "session-empty": [],
};

// Episode data covering all outcomes for the mock SSE stream
export const mockEpisodes = {
  episodeSuccess,
  episodeStopped,
  episodeTimeout,
  episodeSafety,
};

export function fetchMockSessions(): Promise<Session[]> {
  return mockDelay(mockSessions, 0.03);
}

export function fetchMockMessages(sessionId: string): Promise<Message[]> {
  return mockDelay(mockMessages[sessionId] ?? [], 0.02);
}

/** POST /sessions — used by /control/new before redirecting. */
/** Đặt tên phiên từ câu lệnh đầu tiên, giống cách các app chat vẫn làm.
    Cắt ở ranh giới từ để không đứt giữa chữ, bỏ dấu câu cuối. */
export function deriveSessionTitle(text: string): string {
  const firstLine = text.trim().split("\n")[0].trim();
  if (!firstLine) return DEFAULT_SESSION_TITLE;
  if (firstLine.length <= 52) return firstLine.replace(/[.,;:!?]+$/, "");
  const cut = firstLine.slice(0, 52);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:!?]+$/, "") + "…";
}

/** POST /sessions/{id}/messages — ghi tin nhắn người dùng vào phiên.

    Không chỉ để lưu tin: đây là chỗ phiên có được DANH TÍNH. Câu lệnh đầu tiên
    trở thành tên phiên, nên danh sách không còn là một dãy "Phiên mới" giống
    hệt nhau. Tên do người dùng tự đặt thì giữ nguyên, không ghi đè. */
export function recordMockUserMessage(sessionId: string, text: string): Promise<Session> {
  const session = mockSessions.find((s) => s.id === sessionId);
  if (!session) return Promise.reject({ code: "AGENT_012", message: "Không tìm thấy phiên." });

  const list = mockMessages[sessionId] ?? (mockMessages[sessionId] = []);
  const isFirst = list.length === 0;
  list.push({
    id: `msg-${Date.now().toString(36)}`,
    session_id: sessionId,
    role: "user",
    content: text,
    created_at: new Date().toISOString(),
  });

  if (isFirst && session.title === DEFAULT_SESSION_TITLE) {
    session.title = deriveSessionTitle(text);
  }
  session.last_message_preview = text.trim().split("\n")[0];
  session.updated_at = new Date().toISOString();
  return mockDelay(session, 0);
}

export function createMockSession(robotId: string): Promise<Session> {
  /* Bấm "Phiên mới" nhiều lần mà chưa gõ gì thì không đẻ ra một dãy phiên rỗng
     giống hệt nhau — quay lại đúng phiên trống sẵn có. Phiên chỉ thật sự tồn
     tại khi có nội dung. */
  const reusable = mockSessions.find(
    (s) =>
      s.robot_id === (robotId || mockSessions[0].robot_id) &&
      s.title === DEFAULT_SESSION_TITLE &&
      (mockMessages[s.id]?.length ?? 0) === 0,
  );
  if (reusable) return mockDelay(reusable, 0);

  const id = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const session: Session = {
    id,
    title: DEFAULT_SESSION_TITLE,
    robot_id: robotId || mockSessions[0].robot_id,
    created_at: now,
    updated_at: now,
    active_run: null,
    last_message_preview: null,
    pinned: false,
  };
  mockSessions.unshift(session);
  mockMessages[id] = [];
  return mockDelay(session, 0.02);
}

/** PATCH /sessions/{id} — optimistic rename with server confirmation. */
export function renameMockSession(sessionId: string, title: string): Promise<Session> {
  const session = mockSessions.find((s) => s.id === sessionId);
  if (!session) return Promise.reject({ code: "AGENT_012", message: "Không tìm thấy phiên." });
  session.title = title;
  session.updated_at = new Date().toISOString();
  return mockDelay(session, 0.08);
}

/** DELETE /sessions/{id} — rejects with 409 AGENT_020 while a run is active. */
/** PATCH /sessions/{id} — ghim hoặc bỏ ghim. */
export function pinMockSession(sessionId: string, pinned: boolean): Promise<Session> {
  const session = mockSessions.find((s) => s.id === sessionId);
  if (!session) return Promise.reject({ code: "AGENT_012", message: "Không tìm thấy phiên." });
  session.pinned = pinned;
  return mockDelay(session, 0.08);
}

export function deleteMockSession(sessionId: string): Promise<void> {
  const index = mockSessions.findIndex((s) => s.id === sessionId);
  if (index === -1) return Promise.reject({ code: "AGENT_012", message: "Không tìm thấy phiên." });
  if (mockSessions[index].active_run) {
    return Promise.reject({ code: "AGENT_020", message: "Phiên đang chạy nhiệm vụ." });
  }
  mockSessions.splice(index, 1);
  return mockDelay(undefined, 0.05);
}
