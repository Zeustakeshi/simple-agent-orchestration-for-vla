"use client";
/* P04 — ĐIỀU KHIỂN / CHAT ⭐
   The screen the product exists for. Left: the conversation with the agent and
   the composer. Right: what the robot sees and reports.

   The chain in MASTER §13.1 is visible end to end:
     user message → agent reply → tool card → observation → episode bar → outcome

   No chain-of-thought is rendered — only the closed set of user-facing statuses
   (§13.2). There is no background video here; the only moving image is the
   robot camera (§8). */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal, TriangleAlert, Info, X } from "lucide-react";
import { useDismissable } from "@/hooks/useDismissable";

import { HaltButton } from "@/components/robot-state/HaltButton";
import { MessageList } from "@/components/chat/MessageList";
import { Composer } from "@/components/chat/Composer";
import { JointTable } from "@/components/robot-state/JointTable";
import { TelemetryChart } from "@/components/robot-state/TelemetryChart";
import { CameraPanel } from "@/components/camera/CameraPanel";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorPanel } from "@/components/common/ErrorMessage";
import { ConfirmDialog } from "@/components/common/Dialog";
import { Skeleton } from "@/components/common/Skeleton";

import { useSessionStream } from "@/hooks/useSessionStream";
import { actionAvailability } from "@/lib/robot-actions";
import { toErrorObject, type ErrorObject } from "@/lib/errors";
import { recordMockUserMessage } from "@/lib/mock/sessions";
import { fetchSession, fetchMessages, newSessionHref } from "@/lib/api/sessions";
import { USE_MOCK } from "@/lib/api/config";
import { fetchAgentStatus } from "@/lib/api/status";
import { fetchRobots } from "@/lib/api/robots";
import { mockRobots } from "@/lib/mock/robots";
import {
  useAuthStore,
  useRealtimeStore,
  useUiPreferenceStore,
  toast,
  type Message,
  type Session,
  type Robot,
  type AgentStatusLabel,
  type ArtifactTab,
} from "@/stores";

/* ---------------------------------------------------------------- pieces */

/** Nói thẳng khi agent đang chạy trên robot GIẢ LẬP.
 *
 * Không cấu hình `MCP_ENDPOINT_URL` thì backend lặng lẽ dùng `MockEdgeTransport`:
 * `capture_tool` trả ảnh xám, `take_action` trả SUCCESS sau một giây. Agent
 * tường thuật lại y như thật — với nó, tool nói gì thì đó là sự thật — nên
 * người dùng đọc được câu "Robot đã nhặt thành công chiếc cốc" trong khi không
 * có cánh tay nào cử động.
 *
 * Agent không thể tự biết điều này để nói ra; chỗ duy nhất biết là cấu hình
 * server. Vì vậy giao diện phải nói hộ, và phải nói THƯỜNG TRỰC chứ không phải
 * một toast thoáng qua: đây là điều kiện đang tồn tại suốt phiên, không phải
 * một sự kiện.
 *
 * Màu amber chứ không phải đỏ: đây không phải lỗi, chạy giả lập là hợp lệ khi
 * đang phát triển. Nó chỉ không được phép im lặng. */
function SimulationNotice() {
  const [simulated, setSimulated] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchAgentStatus().then((s) => {
      if (!cancelled && s) setSimulated(s.robot_transport === "mock");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!simulated) return null;
  return (
    <span
      className="hidden md:inline-flex items-center gap-1.5 shrink-0 h-6 px-2.5 rounded-full bg-amber-400/12 text-amber-400 text-[11.5px] font-medium"
      title="Chưa cấu hình MCP_ENDPOINT_URL nên agent chạy trên robot giả lập. Mọi kết quả robot đều là giả — không có cánh tay nào chuyển động."
    >
      <TriangleAlert size={12} />
      Robot giả lập
    </span>
  );
}

/** The one status line allowed while the agent works — MASTER §13.2. */
function AgentStatusLine({ status }: { status: AgentStatusLabel | null }) {
  if (!status) return null;
  return (
    <span className="hidden sm:flex items-center gap-1.5 text-[12px] text-haze-300">
      <span className="w-1.5 h-1.5 rounded-full bg-arc-500 animate-pulse-dot" />
      {status}
    </span>
  );
}

/* Hai tab, không phải ba. P04 §7 đặc tả thêm tab "Ảnh", nhưng ảnh mà agent
   chụp đã nằm ngay trong tool card `capture_tool` giữa dòng hội thoại — đúng
   mắt xích "quan sát" của §13.1 — nên tab riêng chỉ là chỗ thứ hai chứa cùng
   một thứ, và làm hẹp mất khung camera. */
const TABS: { key: ArtifactTab; label: string }[] = [
  { key: "camera", label: "Camera" },
  { key: "state", label: "Trạng thái" },
];

function ArtifactPanel({
  robotId,
  robotName,
  robot,
  cameraUnavailable,
}: {
  robotId: string;
  robotName: string;
  /* Robot truyền xuống từ trang, KHÔNG tra `mockRobots` tại chỗ: với dữ liệu
     thật thì mảng tĩnh đó không chứa con robot đang chạy, nên biểu đồ telemetry
     im lặng rơi về bảng khớp và không ai biết vì sao. */
  robot: Robot | null;
  cameraUnavailable?: string;
}) {
  const tab = useUiPreferenceStore((s) => s.artifactTab);
  const setTab = useUiPreferenceStore((s) => s.setArtifactTab);
  const liveRobotState = useRealtimeStore((s) => s.robotState);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Tab opens with the fetched state, then only SSE updates it (P04 §7).
  const joints = liveRobotState?.joints ?? robot?.joints ?? [];

  // Arrow-key navigation across the tab strip (MASTER §15).
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (index + 1) % TABS.length : (index - 1 + TABS.length) % TABS.length;
    setTab(TABS[next].key);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="h-10 border-b border-[var(--line)] flex shrink-0" role="tablist" aria-label="Dữ liệu từ robot">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={`flex-1 relative text-[13px] font-medium transition-colors duration-[120ms] focus-ring cursor-pointer ${
              tab === t.key ? "text-paper-50" : "text-haze-500 hover:text-haze-300"
            }`}
          >
            {t.label}
            {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-arc-500" />}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === "camera" && (
          <CameraPanel
            robotId={robotId}
            robotName={robotName}
            unavailableReason={cameraUnavailable}
            className="h-full min-h-[260px]"
          />
        )}

        {tab === "state" &&
          (joints.length === 0 ? (
            <EmptyState message="Chưa đọc được trạng thái khớp của robot." />
          ) : (
            <div className="space-y-4">
              <div className="border-t border-[var(--line)] pt-3">
                {robot ? <TelemetryChart robot={robot} /> : <JointTable joints={joints} detailed />}
              </div>
            </div>
          ))}

      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function ControlPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = (params?.sessionId as string) ?? "";
  // "Chạy lại" from a failed run (P09) lands here with the text prefilled.
  const prefillFromUrl = searchParams?.get("prefill") ?? undefined;

  const selectedRobotId = useAuthStore((s) => s.selectedRobotId);
  const agentStatus = useRealtimeStore((s) => s.agentStatus);
  const streamingMessage = useRealtimeStore((s) => s.streamingMessage);
  const composerLocked = useRealtimeStore((s) => s.composerLocked);
  const banner = useRealtimeStore((s) => s.banner);
  const setBanner = useRealtimeStore((s) => s.setBanner);
  const liveRobotState = useRealtimeStore((s) => s.robotState);

  const splitRatio = useUiPreferenceStore((s) => s.controlSplitRatio);
  const setSplitRatio = useUiPreferenceStore((s) => s.setSplitRatio);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<ErrorObject | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [mobileTab, setMobileTab] = useState<"chat" | "camera">("chat");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissable(menuOpen, menuRef, useCallback(() => setMenuOpen(false), []));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>(prefillFromUrl);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /* Phiên tải BẤT ĐỒNG BỘ qua tầng API.
     Trước đây chỗ này là `mockSessions.find(...)` — một mảng tĩnh trong bundle.
     Với phiên thật thì không bao giờ tìm thấy, nên trang mở ra như một phiên
     rỗng và toàn bộ hội thoại đã chat coi như biến mất. */
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId)
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  /* Danh sách robot nạp từ backend. `mockRobots[0]` chỉ còn là chốt cuối để
     trang không vỡ khi chưa nạp xong hoặc backend chưa trả robot nào — mọi
     hành động đều đi qua `actionAvailability`, nên robot chốt ở trạng thái
     mặc định thì các nút tự khoá kèm lý do, không phải khoá âm thầm. */
  const [robots, setRobots] = useState<Robot[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchRobots()
      .then((data) => {
        if (!cancelled) setRobots(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const robot =
    robots.find((r) => r.id === (session?.robot_id ?? selectedRobotId)) ??
    robots[0] ??
    mockRobots[0];

  // Robot state prefers live SSE over the last fetched snapshot.
  const robotStatus = liveRobotState?.robot_status ?? robot.robot_status;
  const connectionStatus = liveRobotState?.connection_status ?? robot.connection_status;

  const { startRun } = useSessionStream({ sessionId, setMessages });

  /* ---- load the transcript (GET /sessions/{id}/messages) ---- */
  useEffect(() => {
    let cancelled = false;
    fetchMessages(sessionId)
      .then((msgs) => {
        if (cancelled) return;
        setMessages(msgs);
        setLoadState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(toErrorObject(err));
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadAttempt]);

  const retryLoad = useCallback(() => {
    setLoadState("loading");
    setLoadError(null);
    setLoadAttempt((a) => a + 1);
  }, []);

  /* ---- resizable split, keyboard-operable ---- */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSplitRatio(Math.min(Math.max((e.clientX - rect.left) / rect.width, 0.3), 0.7));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, setSplitRatio]);

  const onSeparatorKeyDown = (e: React.KeyboardEvent) => {
    const step = 0.02;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSplitRatio(Math.max(splitRatio - step, 0.3));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSplitRatio(Math.min(splitRatio + step, 0.7));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSplitRatio(0.3);
    } else if (e.key === "End") {
      e.preventDefault();
      setSplitRatio(0.7);
    }
  };

  /* ---- sending ---- */
  const send = useCallback(
    (text: string, idempotencyKey: string) => {
      const optimistic: Message = {
        id: `msg-local-${idempotencyKey}`,
        session_id: sessionId,
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
        send_status: "sending",
      };
      setMessages((prev) => [...prev, optimistic]);
      setPrefill(undefined);

      // POST /messages is never retried automatically (P04 §6) — on failure the
      // bubble is marked and the user decides, reusing the same key.
      window.setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? { ...m, send_status: "sent" as const } : m)),
        );
        /* Ghi tin nhắn vào phiên. Câu lệnh đầu tiên đồng thời đặt tên cho phiên
           — nếu không thì danh sách Lịch sử phiên toàn là "Phiên mới" giống hệt
           nhau, không phân biệt được cái nào với cái nào.

           CHỈ ở chế độ mock. Chạy thật thì `POST /chat/start` đã tự ghi tin
           nhắn user và đặt tên phiên ở phía server; gọi thêm ở đây là ghi vào
           kho mock — không ai đọc, và tạo cảm giác sai rằng client là nơi chịu
           trách nhiệm lưu hội thoại. */
        if (USE_MOCK) {
          void recordMockUserMessage(sessionId, text).catch(() => undefined);
        }
        startRun(text);
      }, 260);
    },
    [sessionId, startRun],
  );

  const retrySend = useCallback(
    (message: Message) => {
      // Same idempotency key: the id already carries it.
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, send_status: "sending" as const } : m)),
      );
      window.setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, send_status: "sent" as const } : m)),
        );
        startRun(message.content);
      }, 260);
    },
    [startRun],
  );

  const halt = actionAvailability("halt", robotStatus, connectionStatus);
  const camera = actionAvailability("viewCamera", robotStatus, connectionStatus);
  const cameraUnavailable = camera.state === "disabled" ? camera.reason : undefined;

  const chatColumn = (
    <>
      {loadState === "error" && loadError ? (
        <div className="flex-1 min-h-0 p-5">
          <ErrorPanel error={loadError} onRetry={retryLoad} />
        </div>
      ) : (
        <MessageList
          messages={messages}
          streamingContent={streamingMessage?.content}
          loading={loadState === "loading"}
          onRetry={retrySend}
        />
      )}

      {/* Run-level banner: stopped / disconnected / failed (P04 §8) */}
      {banner && (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          className={`mx-3 mb-2 rounded-lg px-3 py-2.5 text-[13px] flex items-start gap-2 ${
            banner.tone === "error"
              ? "bg-halt-500/12 border border-halt-500/40 text-halt-500"
              : "bg-ink-800 border border-[var(--line)] text-haze-300"
          }`}
        >
          {banner.tone === "error" ? (
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={15} className="mt-0.5 shrink-0" />
          )}
          <span className="flex-1">{banner.message}</span>
          {banner.code && (
            <button
              type="button"
              onClick={() => {
                const lastUser = [...messages].reverse().find((m) => m.role === "user");
                if (lastUser) setPrefill(lastUser.content);
                setBanner(null);
              }}
              className="underline hover:no-underline focus-ring rounded cursor-pointer shrink-0"
            >
              Thử lại
            </button>
          )}
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Đóng thông báo"
            className="p-0.5 rounded focus-ring cursor-pointer shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <Composer
        robotStatus={robotStatus}
        connectionStatus={connectionStatus}
        composerLocked={composerLocked}
        onSend={send}
        prefillText={prefill}
        /* Chỉ mồi khi hội thoại còn trống. Giữ chúng ở đó suốt phiên thì chúng
           đẩy khung chat lên và biến thành đồ trang trí — người dùng đã biết
           gõ gì rồi. */
        showSuggestions={loadState === "ready" && messages.length === 0}
      />
    </>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header — P04 §2 */}
      <header className="h-14 px-4 sm:px-5 border-b border-[var(--line)] flex items-center justify-between gap-3 bg-ink-900 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {/* Đường dẫn ngược về danh sách. Hai mục nav "Phiên mới" và "Lịch sử
              phiên" dẫn tới cùng màn hình này, nên phải nói rõ đang ở phiên nào
              và cho lối quay ra — nếu không thì vào rồi mắc kẹt, không biết
              mình đang xem cái gì trong số các phiên đã có. */}
          <nav aria-label="Đường dẫn" className="flex items-center gap-2 min-w-0 text-[13px]">
            <Link
              href="/sessions"
              className="text-haze-500 hover:text-paper-50 transition-colors duration-[120ms] focus-ring rounded shrink-0"
            >
              Lịch sử phiên
            </Link>
            <span className="text-haze-500 shrink-0" aria-hidden="true">
              /
            </span>
            {loadState === "loading" ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              <span className="text-paper-50 font-medium truncate">
                {session?.title ?? "Phiên mới"}
              </span>
            )}
          </nav>

          {/* KHÔNG lặp lại badge trạng thái robot ở đây.
              Topbar ngay phía trên đã hiện nó rồi, và hai badge nằm cách nhau
              một dòng thì không đọc ra "hai thông tin" mà ra "một thông tin bị
              in hai lần". Tệ hơn: hai chỗ lấy từ hai nguồn khác nhau — topbar
              từ `selectedRobot` của shell, chỗ này từ `robotStatus` của trang —
              nên có lúc chúng lệch nhau, và người dùng không biết tin cái nào.
              Tên robot vẫn đi vào aria-label của camera cho trình đọc màn hình. */}
          <AgentStatusLine status={agentStatus} />
          <SimulationNotice />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Mobile: chat ⇄ camera */}
          <div className="flex md:hidden rounded-lg overflow-hidden border border-[var(--line)]">
            {(["chat", "camera"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setMobileTab(t)}
                aria-pressed={mobileTab === t}
                className={`px-3 h-8 text-[12px] font-medium transition-colors duration-[120ms] focus-ring cursor-pointer ${
                  mobileTab === t ? "bg-ink-700 text-paper-50" : "text-haze-500"
                }`}
              >
                {t === "chat" ? "Trò chuyện" : "Camera"}
              </button>
            ))}
          </div>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Tuỳ chọn phiên"
              aria-expanded={menuOpen}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-haze-300 hover:text-paper-50 hover:bg-ink-700 transition-colors duration-[120ms] focus-ring cursor-pointer"
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-30 w-44 menu-surface py-1">
                {/* Đang chat mà muốn mở phiên khác thì không phải chạy ra
                    sidebar — và trên mobile sidebar đang ẩn sau sheet nên đây
                    là lối duy nhất với tới được. */}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    // `?new=1`: `/control/new` trơn giờ mở lại phiên gần nhất.
                    router.push(newSessionHref(robot.id));
                  }}
                  className="w-full text-left px-3 h-9 text-[13px] text-paper-50 hover:bg-ink-700 focus-ring cursor-pointer"
                >
                  Phiên mới
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    toast.info("Đổi tên phiên ở trang Lịch sử phiên.");
                  }}
                  className="w-full text-left px-3 h-9 text-[13px] text-haze-300 hover:text-paper-50 hover:bg-ink-700 focus-ring cursor-pointer"
                >
                  Đổi tên phiên
                </button>
                {/* Ngăn cách hành động phá huỷ khỏi hai hành động thường, để
                    không bấm nhầm khi menu vừa bung ra. */}
                <span className="block my-1 h-px bg-[var(--line)]" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDelete(true);
                  }}
                  className="w-full text-left px-3 h-9 text-[13px] text-halt-500 hover:bg-halt-500/10 focus-ring cursor-pointer"
                >
                  Xoá phiên
                </button>
              </div>
            )}
          </div>

          {/* Halt is never inside a dialog and never disabled — MASTER §12.1 */}
          <HaltButton
            robotId={robot.id}
            visible={halt.state !== "hidden"}
            className="hidden md:inline-flex"
          />
        </div>
      </header>

      {/* Mobile layout */}
      <div className="flex-1 min-h-0 flex flex-col md:hidden">
        {mobileTab === "chat" ? (
          chatColumn
        ) : (
          <div className="flex-1 min-h-0 p-3">
            <ArtifactPanel
              robotId={robot.id}
              robotName={robot.name}
              robot={robot}
              cameraUnavailable={cameraUnavailable}
            />
          </div>
        )}
        {halt.state !== "hidden" && (
          <div className="sticky bottom-0 z-40 p-3 bg-ink-900/95 border-t border-[var(--line)]">
            <HaltButton robotId={robot.id} visible className="w-full" />
          </div>
        )}
      </div>

      {/* Desktop layout — draggable split, persisted */}
      <div ref={containerRef} className="hidden md:flex flex-1 min-h-0">
        <div className="flex flex-col min-w-[420px] min-h-0" style={{ width: `${splitRatio * 100}%` }}>
          {chatColumn}
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Điều chỉnh tỉ lệ hai cột"
          aria-valuenow={Math.round(splitRatio * 100)}
          aria-valuemin={30}
          aria-valuemax={70}
          tabIndex={0}
          onMouseDown={() => setDragging(true)}
          onKeyDown={onSeparatorKeyDown}
          className="group relative w-1 shrink-0 cursor-col-resize touch-none focus-ring"
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-6 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-arc-500 transition-opacity duration-[120ms] ${
              dragging ? "opacity-100" : "opacity-0 group-hover:opacity-60"
            }`}
          />
        </div>

        <div className="flex-1 min-w-[320px] min-h-0 py-3 pr-3">
          <ArtifactPanel
              robotId={robot.id}
              robotName={robot.name}
              robot={robot}
              cameraUnavailable={cameraUnavailable}
            />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          toast.success("Đã xoá phiên.");
          router.push("/sessions");
        }}
        title="Xoá phiên này?"
        description="Toàn bộ tin nhắn và tool card của phiên sẽ bị xoá. Nhật ký chạy vẫn được giữ ở trang Nhật ký."
        confirmLabel="Xoá phiên"
      />
    </div>
  );
}
