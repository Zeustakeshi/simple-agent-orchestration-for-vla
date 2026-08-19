"use client";
/* P09 — NHẬT KÝ (danh sách)
   Every filter is mirrored into the URL query so a filtered view can be shared
   as a link. Table at ≥768px, cards below — never a horizontally scrolling
   table (MASTER §17). */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorPanel } from "@/components/common/ErrorMessage";
import { Skeleton, SkeletonRow } from "@/components/common/Skeleton";

import { fetchRuns } from "@/lib/api/runs";
import { formatAbsolute, formatRelative, formatDuration } from "@/lib/format";
import { toErrorObject, type ErrorObject } from "@/lib/errors";
import type { Run, RunStatus, RunSource } from "@/stores";

/* `TIMEOUT` vào cả danh sách chip lẫn bảng nhãn: develop thêm trạng thái này,
   mà một trạng thái lọc được nhưng không có chip thì người dùng không có cách
   nào xem riêng nhóm run bị cắt vì quá giờ. */
const STATUS_CHIPS: RunStatus[] = [
  "RUNNING",
  "SCHEDULED",
  "COMPLETED",
  "FAILED",
  "TIMEOUT",
  "CANCELLED",
];
const SOURCE_CHIPS: RunSource[] = ["CHAT", "SCHEDULE", "MANUAL_RUN"];
const SOURCE_LABEL: Record<RunSource, string> = {
  CHAT: "Trò chuyện",
  SCHEDULE: "Lịch chạy",
  MANUAL_RUN: "Chạy tay",
};
const STATUS_LABEL: Record<RunStatus, string> = {
  RUNNING: "Đang chạy",
  WAITING_TOOL: "Chờ tool",
  COMPLETED: "Hoàn thành",
  FAILED: "Thất bại",
  TIMEOUT: "Quá giờ",
  CANCELLED: "Đã huỷ",
  SCHEDULED: "Chờ chạy",
};

function RunsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [runs, setRuns] = useState<Run[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<ErrorObject | null>(null);
  const [attempt, setAttempt] = useState(0);

  const robotId = searchParams?.get("robot_id") ?? "";
  /* Giữ dạng CHUỖI của bộ lọc làm nguồn sự thật cho effect.

     `statuses` là mảng mới ở mỗi lần render nên không dùng làm dependency được;
     nhét `statuses.join(",")` thẳng vào mảng phụ thuộc thì lint không kiểm tra
     tĩnh được, và chỉ cần ai đó đổi biểu thức là effect âm thầm chạy sai nhịp.
     Tính sẵn ra biến thì cả React lẫn lint đều so sánh được bằng giá trị. */
  const statusParam = searchParams?.get("status") ?? "";
  const sourceParam = searchParams?.get("source") ?? "";
  const statuses = statusParam.split(",").filter(Boolean);
  const sources = sourceParam.split(",").filter(Boolean);
  const hasError = searchParams?.get("has_error") === "1";
  const hasFilters = Boolean(robotId || statuses.length || sources.length || hasError);

  useEffect(() => {
    let cancelled = false;
    fetchRuns({
      robot_id: robotId || undefined,
      status: statusParam || undefined,
      source: sourceParam || undefined,
      has_error: hasError || undefined,
    })
      .then((data) => {
        if (cancelled) return;
        setRuns(data);
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
  }, [attempt, robotId, statusParam, sourceParam, hasError]);

  /** Filters live in the URL — one writer, shareable result. */
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (value) next.set(key, value);
      else next.delete(key);
      router.replace(next.toString() ? `${pathname}?${next}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const toggleInParam = useCallback(
    (key: string, value: string) => {
      const current = (searchParams?.get(key) ?? "").split(",").filter(Boolean);
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      setParam(key, next.join(",") || null);
    },
    [searchParams, setParam],
  );

  const visible = runs;

  /* Bấm vào một dòng LUÔN mở chi tiết lượt chạy đó.

     Code lấy từ nhánh khác đá người dùng sang `/control/{session_id}` khi run
     có nguồn CHAT, và sang `/schedules/...` khi đang chờ chạy. Nghe thì tiện,
     nhưng nó phá vỡ điều duy nhất người dùng suy đoán được ở một danh sách:
     bấm vào mục nào thì xem được mục đó. Ở đây ba dòng nhìn giống hệt nhau lại
     dẫn tới ba nơi khác nhau, và hai trong ba nơi đó thuộc mục khác trên
     sidebar — đúng vấn đề đã gặp trước đây giữa Điều khiển và Lịch sử phiên.

     Muốn nhảy sang phiên trò chuyện hay lịch thì đặt liên kết TRONG trang chi
     tiết, nơi có chỗ ghi rõ nó dẫn đi đâu. */
  /* Bấm một dòng thì Ở LẠI trong Nhật ký.
   *
   * Ngoại lệ duy nhất là dòng `SCHEDULED`: lịch tới giờ nhưng chưa khởi động
   * thì chưa có gì để xem, dẫn về chính cái lịch mới có nội dung.
   *
   * Dòng `session:<id>` — gộp một phiên chat thành một dòng — trước đây bị đẩy
   * sang khu Trò chuyện vì `GET /runs/{id}` không hiểu id đó và trả 404. Nay
   * backend dựng được bản gộp cho chúng, nên chi tiết lượt chạy mở ngay tại
   * đây: timeline, tham số, kết quả. Rời khỏi Nhật ký để xem một mục của Nhật
   * ký là bắt người dùng đi vòng.
   */
  const openRun = (run: Run) => {
    if (run.status === "SCHEDULED" && run.schedule_id) {
      router.push(`/schedules/${encodeURIComponent(run.schedule_id)}`);
      return;
    }
    router.push(`/runs/${encodeURIComponent(run.id)}`);
  };

  const chipClass = (active: boolean) =>
    `h-7 px-2.5 rounded-full text-[12px] font-medium border transition-colors duration-[120ms] focus-ring cursor-pointer ${
      active
        ? "bg-arc-500/15 text-arc-400 border-arc-500/40"
        : "bg-ink-800 text-haze-500 border-[var(--line)] hover:text-paper-50"
    }`;

  return (
    <div className="p-4 sm:p-6 max-w-[1440px] mx-auto space-y-4">
      {/* Không có nút "Phiên mới" ở đây: tạo phiên là hành động của mục Điều
          khiển, không phải của Nhật ký. Nút hành động của mục khác đặt lẫn vào
          đây thì người dùng bấm nhầm rồi bị đẩy sang trang khác. */}
      <h1 className="display-l text-paper-50">Nhật ký</h1>

      {/* Filter bar — sticks under the topbar */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-ink-900/95 backdrop-blur-none border-b border-[var(--line)] flex flex-wrap items-center gap-2">
        {/* KHÔNG có ô lọc robot. Sản phẩm vận hành đúng một cánh tay, nên ô
            "Mọi robot" chỉ có một lựa chọn thật — lọc theo nó không thu hẹp
            được gì. Tham số `robot_id` trên URL vẫn được tôn trọng nếu ai đó
            gửi link đã lọc sẵn; chỉ là không còn chỗ bấm để tạo ra nó. */}

        <span className="flex items-center gap-1.5 flex-wrap">
          {STATUS_CHIPS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => toggleInParam("status", status)}
              aria-pressed={statuses.includes(status)}
              className={chipClass(statuses.includes(status))}
            >
              {STATUS_LABEL[status]}
            </button>
          ))}
        </span>

        <span className="flex items-center gap-1.5 flex-wrap">
          {SOURCE_CHIPS.map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => toggleInParam("source", source)}
              aria-pressed={sources.includes(source)}
              className={chipClass(sources.includes(source))}
            >
              {SOURCE_LABEL[source]}
            </button>
          ))}
        </span>

        <label className="flex items-center gap-2 text-[12.5px] text-haze-300 cursor-pointer">
          <input
            type="checkbox"
            checked={hasError}
            onChange={(e) => setParam("has_error", e.target.checked ? "1" : null)}
            className="accent-arc-500 focus-ring"
          />
          Chỉ lượt có lỗi
        </label>

        {hasFilters && (
          <button type="button" onClick={() => router.replace(pathname, { scroll: false })} className="btn-ghost !h-7 !text-[12px] focus-ring">
            Xoá bộ lọc
          </button>
        )}
      </div>

      {state === "loading" && (
        <div className="panel divide-y divide-[var(--line)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonRow key={i} />
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
            message={hasFilters ? "Không có lượt chạy nào khớp bộ lọc." : "Chưa có lượt chạy nào được ghi lại."}
            action={
              hasFilters ? (
                <button type="button" onClick={() => router.replace(pathname, { scroll: false })} className="btn-ghost focus-ring">
                  Xoá bộ lọc
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* ≥768px: table */}
            <div className="panel overflow-hidden hidden md:block">
              <table className="w-full">
                <thead className="bg-ink-900">
                  <tr className="border-b border-[var(--line)]">
                    <th className="eyebrow text-left px-4 py-2 font-medium">Thời gian</th>
                    <th className="eyebrow text-left px-4 py-2 font-medium">Nguồn</th>
                    <th className="eyebrow text-left px-4 py-2 font-medium">Trạng thái</th>
                    <th className="eyebrow text-left px-4 py-2 font-medium">Đầu vào</th>
                    <th className="eyebrow text-left px-4 py-2 font-medium">Thời lượng</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((run) => (
                    <tr
                      key={run.id}
                      onClick={() => openRun(run)}
                      className="border-b border-[var(--line)] last:border-0 hover:bg-ink-700 cursor-pointer transition-colors duration-[120ms]"
                    >
                      <td className="px-4 py-2.5 data text-[11.5px] whitespace-nowrap" title={formatAbsolute(run.created_at)}>
                        {formatRelative(run.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge kind="source" value={run.source} />
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge kind="run" value={run.status} />
                      </td>
                      <td className="px-4 py-2.5 text-[13px] text-paper-50 max-w-[320px] truncate">{run.input_text}</td>
                      <td className="px-4 py-2.5 data text-[11.5px]">{formatDuration(run.duration_s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* <768px: cards */}
            <ul className="md:hidden space-y-2">
              {visible.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => openRun(run)}
                    className="panel-inset w-full text-left p-4 hover:border-[var(--line-strong)] transition-colors duration-[120ms] focus-ring"
                  >
                    <span className="flex items-center gap-2 mb-2">
                      <StatusBadge kind="run" value={run.status} />
                      <StatusBadge kind="source" value={run.source} />
                      <span className="data text-[11px] text-haze-500 ml-auto">{formatDuration(run.duration_s)}</span>
                    </span>
                    <span className="block text-[13px] text-paper-50">{run.input_text}</span>
                    <span className="block data text-[11px] text-haze-500 mt-1" title={formatAbsolute(run.created_at)}>
                      {formatRelative(run.created_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
    </div>
  );
}

export default function RunsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 max-w-[1440px] mx-auto space-y-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      }
    >
      <RunsContent />
    </Suspense>
  );
}
