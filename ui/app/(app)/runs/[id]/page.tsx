"use client";
/* P09 — CHI TIẾT NHẬT KÝ
   Answers "what did the system do, and why did it fail that time?"
   `Chạy lại` only appears for a failed/cancelled CHAT run: it navigates to the
   session and prefills the composer — it never sends on the user's behalf. */

import { useState, useEffect, useMemo, Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, RotateCw } from "lucide-react";

import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorPanel, ErrorMessage } from "@/components/common/ErrorMessage";
import { CopyableCode } from "@/components/common/CopyableCode";
import { Skeleton } from "@/components/common/Skeleton";
import { EpisodeProgress } from "@/components/chat/EpisodeProgress";
import { LogViewer } from "@/components/logs/LogViewer";
import { TimelineView, type TimelineEntry } from "@/components/logs/TimelineView";

import { fetchRun } from "@/lib/api/runs";
import { fetchRobots } from "@/lib/api/robots";
import { USE_MOCK } from "@/lib/api/config";
import { fetchMockLogs, fetchMockTimeline, type MockLogEntry } from "@/lib/mock/runs";
import { getRunTimeline } from "@/lib/api/runs";
import { traceEventsToTimeline } from "@/lib/api/run-timeline";
import { formatAbsolute, formatDuration } from "@/lib/format";
import { toErrorObject, type ErrorObject } from "@/lib/errors";
import type { Run } from "@/stores";

type Tab = "timeline" | "logs";

const TABS: { key: Tab; label: string }[] = [
  { key: "timeline", label: "Dòng thời gian" },
  { key: "logs", label: "Nhật ký" },
];

function RunDetail() {
  const params = useParams();
  const router = useRouter();
  /* GIẢI MÃ tham số đường dẫn.
   *
   * `useParams()` trả về đoạn URL còn NGUYÊN dạng mã hoá. Id của dòng gộp phiên
   * là `session:ses_xxx`, link tạo ra là `/runs/session%3Ases_xxx`, rồi
   * `getRun` mã hoá thêm lần nữa thành `session%253A...` — backend nhận đúng
   * chuỗi đó, không khớp gì, trả 404 và trang hiện "Agent không hoàn thành được
   * nhiệm vụ". Thông báo sai hẳn nguyên nhân: chẳng có agent nào thất bại, chỉ
   * là một dấu hai chấm bị mã hoá hai lần.
   *
   * Chỉ những id có ký tự đặc biệt mới lộ ra lỗi này, nên nó ngủ yên cho tới
   * lúc dòng `session:` xuất hiện. `try` vì tham số hỏng không được làm sập cả
   * trang — id lạ thì cứ để backend trả 404 tử tế. */
  const rawRunId = (params?.id as string) ?? "";
  let runId = rawRunId;
  try {
    runId = decodeURIComponent(rawRunId);
  } catch {
    /* giữ nguyên bản thô */
  }

  const [run, setRun] = useState<Run | null>(null);
  const [robotName, setRobotName] = useState<string | null>(null);
  const [logs, setLogs] = useState<MockLogEntry[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");
  const [error, setError] = useState<ErrorObject | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>("timeline");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchRun(runId),
      fetchRobots(),
      USE_MOCK ? fetchMockLogs(runId) : Promise.resolve([] as MockLogEntry[]),
      /* Chạy thật: timeline dựng từ kho sự kiện trace của backend
         (`GET /runs/{id}/timeline`). Trước đây chỗ này trả mảng RỖNG, nên trang
         chi tiết lượt chạy luôn trống trơn khi tắt mock — dữ liệu vẫn nằm
         nguyên trong database, chỉ là không ai đọc. */
      USE_MOCK
        ? fetchMockTimeline(runId)
        : getRunTimeline(runId).then(traceEventsToTimeline),
    ])
      .then(([runData, robots, logData, timelineData]) => {
        if (cancelled) return;
        if (!runData) {
          setState("missing");
          return;
        }
        setRun(runData);
        setRobotName(robots.find((r) => r.id === runData.robot_id)?.name ?? null);
        setLogs(logData);
        setTimeline(timelineData);
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
  }, [runId, attempt]);

  const isLive = run?.status === "RUNNING" || run?.status === "WAITING_TOOL";

  // Poll logs only while the run is live; stop as soon as it is terminal (P09).
  useEffect(() => {
    if (!isLive || !USE_MOCK) return;
    const interval = setInterval(() => {
      fetchMockLogs(runId)
        .then(setLogs)
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(interval);
  }, [isLive, runId]);

  const canRerun = useMemo(
    () => run !== null && run.source === "CHAT" && (run.status === "FAILED" || run.status === "CANCELLED"),
    [run],
  );

  if (state === "loading") {
    return (
      <div className="p-4 sm:p-6 max-w-[1024px] mx-auto space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  if (state === "error" && error) {
    return (
      <div className="p-6 max-w-[720px] mx-auto mt-10">
        <ErrorPanel
          error={error}
          onRetry={() => {
            setState("loading");
            setError(null);
            setAttempt((a) => a + 1);
          }}
        />
      </div>
    );
  }

  if (state === "missing" || !run) {
    return (
      <div className="p-6 max-w-[720px] mx-auto mt-10">
        <EmptyState
          message="Không tìm thấy lượt chạy này."
          action={
            <button type="button" onClick={() => router.push("/runs")} className="btn-primary focus-ring">
              Về Nhật ký
            </button>
          }
        />
      </div>
    );
  }

  const robotLabel = robotName ?? run.robot_id;

  return (
    <div className="p-4 sm:p-6 max-w-[1024px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => router.push("/runs")}
          aria-label="Quay lại nhật ký"
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-ink-800 hover:bg-ink-700 transition-colors duration-[120ms] focus-ring cursor-pointer shrink-0"
        >
          <ArrowLeft size={17} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge kind="run" value={run.status} size="md" />
            <StatusBadge kind="source" value={run.source} size="md" />
            <span className="data text-[11.5px] text-haze-500">{formatAbsolute(run.created_at)}</span>
            <span className="data text-[11.5px] text-haze-500">{formatDuration(run.duration_s)}</span>
            <CopyableCode value={run.trace_id} label="Trace" />
          </div>
          <p className="body-text text-paper-50 mt-2">{run.input_text}</p>
          <p className="eyebrow mt-1">{robotLabel}</p>
        </div>

        {canRerun && (
          <button
            type="button"
            onClick={() => router.push(`/control/${run.session_id}?prefill=${encodeURIComponent(run.input_text)}`)}
            title="Mở lại phiên và điền sẵn lệnh — bạn vẫn phải bấm gửi"
            className="btn-ghost border border-[var(--line)] focus-ring shrink-0"
          >
            <RotateCw size={14} />
            Chạy lại
          </button>
        )}
      </div>

      {run.error && (
        <div className="panel p-4">
          <ErrorMessage error={{ ...run.error, trace_id: run.trace_id }} />
        </div>
      )}

      {/* Episodes */}
      {run.episodes.length > 0 && (
        <section className="panel p-4 space-y-2">
          <h2 className="eyebrow">Các lượt thực thi</h2>
          {run.episodes.map((episode) => (
            <EpisodeProgress key={episode.id} episode={episode} />
          ))}
        </section>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--line)]" role="tablist" aria-label="Chi tiết lượt chạy">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`relative h-10 px-4 text-[13px] font-medium transition-colors duration-[120ms] focus-ring cursor-pointer ${
              tab === t.key ? "text-paper-50" : "text-haze-500 hover:text-haze-300"
            }`}
          >
            {t.label}
            {tab === t.key && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-arc-500" />}
          </button>
        ))}
      </div>

      {tab === "timeline" &&
        (timeline.length === 0 ? (
          <EmptyState message="Lượt chạy này chưa ghi được mốc nào." />
        ) : (
          <div className="panel p-4">
            <TimelineView entries={timeline} />
          </div>
        ))}

      {tab === "logs" && <LogViewer logs={logs} runTraceId={run.trace_id} live={isLive} />}

    </div>
  );
}

export default function RunDetailPage() {
  return (
    <Suspense fallback={<div className="p-6 max-w-[1024px] mx-auto"><Skeleton className="h-64 rounded-xl" /></div>}>
      <RunDetail />
    </Suspense>
  );
}
