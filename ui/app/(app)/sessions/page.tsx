"use client";
/* P06 — TRÒ CHUYỆN
   Search (debounced 400ms), robot filter, inline rename with rollback, and a
   delete that is refused while a run is active (409 AGENT_020). Row actions
   appear on hover *and* on focus so keyboard users can reach them. */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Pencil, Trash2, Pin } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { ErrorPanel } from "@/components/common/ErrorMessage";
import { ConfirmDialog } from "@/components/common/Dialog";
import { DisabledHint } from "@/components/common/DisabledHint";
import { Skeleton } from "@/components/common/Skeleton";

/* Đi qua tầng API chứ KHÔNG gọi thẳng `lib/mock/sessions`.
   Gọi thẳng mock nghĩa là trang này luôn đọc dữ liệu giả, kể cả khi đã tắt mock
   — nên phiên chat thật không bao giờ xuất hiện ở đây. Các hàm dưới đây tự
   chuyển giữa mock và backend theo `USE_MOCK`, một chỗ quyết định duy nhất. */
import {
  fetchSessions,
  renameSession,
  deleteSession,
  pinSession,
  newSessionHref,
} from "@/lib/api/sessions";
import { formatRelative, formatAbsolute } from "@/lib/format";
import { errorText, toErrorObject, type ErrorObject } from "@/lib/errors";
import { toast, type Session } from "@/stores";

const SEARCH_DEBOUNCE_MS = 400;

export default function SessionsPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<ErrorObject | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [robotFilter, setRobotFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSessions()
      .then((data) => {
        if (cancelled) return;
        setSessions(data);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(toErrorObject(err));
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Debounced search — the real client sends this as `q=`.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(searchInput.trim().toLowerCase()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const visible = useMemo(
    () =>
      sessions
        .filter((session) => {
          if (robotFilter && session.robot_id !== robotFilter) return false;
          if (!showHidden && session.title === "Phiên tự động") return false;
          if (!query) return true;
          return (
            session.title.toLowerCase().includes(query) ||
            (session.last_message_preview ?? "").toLowerCase().includes(query)
          );
        })
        /* Phiên đã ghim luôn lên đầu, kể cả khi đang tìm kiếm — ghim là để
           không phải đi tìm. Trong mỗi nhóm thì phiên động gần đây lên trước. */
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          return Date.parse(b.updated_at) - Date.parse(a.updated_at);
        }),
    [sessions, robotFilter, showHidden, query],
  );

  const pinnedCount = visible.filter((s) => s.pinned).length;

  const startRename = useCallback((session: Session) => {
    setRenamingId(session.id);
    setDraftTitle(session.title);
  }, []);

  const commitRename = useCallback(
    async (session: Session) => {
      const nextTitle = draftTitle.trim();
      setRenamingId(null);
      if (!nextTitle || nextTitle === session.title) return;

      const previous = session.title;
      // Optimistic, with rollback on failure.
      setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, title: nextTitle } : s)));
      try {
        await renameSession(session.id, nextTitle);
        toast.success("Đã đổi tên phiên.");
      } catch (err) {
        setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, title: previous } : s)));
        toast.error(errorText(toErrorObject(err)));
      }
    },
    [draftTitle],
  );

  const togglePin = useCallback(async (session: Session) => {
    const next = !session.pinned;
    // Optimistic, rollback khi lỗi — cùng khuôn với đổi tên.
    setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, pinned: next } : s)));
    try {
      await pinSession(session.id, next);
    } catch (err) {
      setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, pinned: !next } : s)));
      toast.error(errorText(toErrorObject(err)));
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteSession(target.id);
      setSessions((prev) => prev.filter((s) => s.id !== target.id));
      toast.success("Đã xoá phiên.");
    } catch (err) {
      toast.error(errorText(toErrorObject(err)));
    }
  }, [pendingDelete]);

  return (
    <div className="p-4 sm:p-6 max-w-[1440px] mx-auto space-y-4">
      <h1 className="display-l text-paper-50">Lịch sử phiên</h1>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-haze-500 pointer-events-none" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearchInput("")}
            placeholder="Tìm theo tên hoặc nội dung"
            aria-label="Tìm phiên trò chuyện"
            className="h-9 w-full sm:w-[320px] pl-9 pr-3 rounded-lg bg-ink-800 border border-[var(--line)] text-[13px] text-paper-50 placeholder:text-haze-500 focus:outline-none focus-ring"
          />
        </div>

        <label className="flex items-center gap-2 text-[13px] text-haze-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="accent-arc-500 focus-ring"
          />
          Hiện cả phiên tự động
        </label>
      </div>

      {state === "loading" && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[58px] rounded-lg" />
          ))}
        </div>
      )}

      {state === "error" && error && (
        <ErrorPanel
          error={error}
          onRetry={() => {
            setState("loading");
            setError(null);
            setAttempt((a) => a + 1);
          }}
        />
      )}

      {state === "ready" &&
        (visible.length === 0 ? (
          <EmptyState
            message={
              query || robotFilter
                ? "Không có phiên nào khớp bộ lọc."
                : "Chưa có cuộc trò chuyện nào."
            }
            action={
              query || robotFilter ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setRobotFilter("");
                  }}
                  className="btn-ghost focus-ring"
                >
                  Xoá bộ lọc
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => router.push(newSessionHref())}
                  className="btn-primary focus-ring"
                >
                  Bắt đầu điều khiển
                </button>
              )
            }
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((session, index) => {
              const isRenaming = renamingId === session.id;
              const running = Boolean(session.active_run);
              /* Ranh giới giữa nhóm ghim và phần còn lại. Chỉ vẽ khi có cả hai
                 nhóm — chỉ toàn ghim hoặc chỉ toàn thường thì đường kẻ này
                 chẳng ngăn cách cái gì. */
              const startsUnpinned =
                !session.pinned && pinnedCount > 0 && index === pinnedCount;

              return (
                <li
                  key={session.id}
                  className={`group panel-inset px-4 py-3 flex items-center gap-4 hover:border-[var(--line-strong)] transition-colors duration-[120ms] ${
                    startsUnpinned ? "mt-4 relative before:absolute before:-top-2 before:left-0 before:right-0 before:h-px before:bg-[var(--line)]" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        autoFocus
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onBlur={() => commitRename(session)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitRename(session);
                          }
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        aria-label="Tên phiên"
                        className="w-full h-8 px-2 rounded bg-ink-800 border border-arc-500 text-[14px] text-paper-50 focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => router.push(`/control/${session.id}`)}
                        className="block w-full text-left focus-ring rounded cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-paper-50 truncate">{session.title}</span>
                          {running && (
                            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-arc-500/15 text-arc-400 text-[10.5px] font-medium uppercase tracking-[0.06em] shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-arc-400 animate-pulse-dot" />
                              Đang chạy
                            </span>
                          )}
                        </span>
                        <span className="block text-[13px] text-haze-500 truncate mt-0.5">
                          {session.last_message_preview ?? "Chưa có tin nhắn"}
                        </span>
                      </button>
                    )}
                  </div>

                  <span
                    className="data text-[11.5px] text-haze-500 shrink-0 hidden sm:block"
                    title={formatAbsolute(session.updated_at)}
                  >
                    {formatRelative(session.updated_at)}
                  </span>

                  {/* Cả ba nút chung MỘT cụm để khoảng cách giữa chúng bằng
                      nhau. Trước đây nút ghim đứng ngoài nên nó cách hai nút kia
                      bằng gap-4 của hàng, còn hai nút kia chỉ cách nhau gap-1.

                      Luật hiện đặt trên TỪNG nút chứ không cho cả cụm: phiên đã
                      ghim thì nút ghim luôn thấy vì nó là chỉ dấu trạng thái,
                      còn sửa và xoá vẫn đợi rê chuột. */}
                  <span className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => togglePin(session)}
                      title={session.pinned ? "Bỏ ghim" : "Ghim lên đầu"}
                      aria-label={`${session.pinned ? "Bỏ ghim" : "Ghim"} phiên ${session.title}`}
                      aria-pressed={session.pinned}
                      className={`p-1.5 rounded-lg transition-all duration-[120ms] focus-ring cursor-pointer ${
                        session.pinned
                          ? "text-arc-400 hover:bg-ink-700"
                          : "text-haze-500 hover:text-paper-50 hover:bg-ink-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      }`}
                    >
                      {/* Luôn dùng Pin, trạng thái nói bằng MÀU. PinOff có nét
                          gạch chéo nên trông nặng và rộng hơn bút với thùng rác,
                          đứng cạnh nhau là lệch ngay. */}
                      <Pin size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(session)}
                      aria-label={`Đổi tên phiên ${session.title}`}
                      className="p-1.5 rounded-lg text-haze-500 hover:text-paper-50 hover:bg-ink-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-[120ms] focus-ring cursor-pointer"
                    >
                      <Pencil size={14} />
                    </button>
                    {/* Thẻ bọc mang tooltip, không phải cái nút — nút đang
                        disabled thì trình duyệt nuốt mất tooltip của nó.
                        Trạng thái khoá nói bằng MÀU CHỮ chứ không bằng opacity:
                        opacity ở đây đã dành cho việc ẩn/hiện theo hover, hai
                        thứ cùng đặt một thuộc tính sẽ tranh nhau. */}
                    <DisabledHint
                      reason={running ? "Không thể xoá khi phiên đang chạy nhiệm vụ." : undefined}
                      className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[120ms]"
                    >
                      <button
                        type="button"
                        onClick={() => setPendingDelete(session)}
                        disabled={running}
                        title={running ? undefined : "Xoá phiên"}
                        aria-label={`Xoá phiên ${session.title}`}
                        className="p-1.5 rounded-lg text-halt-500 hover:bg-halt-500/10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-colors duration-[120ms] disabled:text-halt-500/40 disabled:hover:bg-transparent disabled:cursor-not-allowed focus-ring cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    </DisabledHint>
                  </span>
                </li>
              );
            })}
          </ul>
        ))}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Xoá phiên này?"
        description={`Toàn bộ tin nhắn của "${pendingDelete?.title ?? ""}" sẽ bị xoá. Nhật ký chạy vẫn được giữ lại.`}
        confirmLabel="Xoá phiên"
      />
    </div>
  );
}
