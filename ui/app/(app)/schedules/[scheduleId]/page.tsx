"use client";
/* P08 — CHI TIẾT LỊCH CHẠY
   Warns at 3–4 consecutive failures, and offers re-enable once the scheduler
   has auto-disabled the job at 5. Rows that never executed (skipped or
   misfired) are not clickable and explain their reason_code from
   errors.vi.json. */

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Play, Info, TriangleAlert } from "lucide-react";

import { ErrorPanel } from "@/components/common/ErrorMessage";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/common/Skeleton";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Switch } from "@/components/common/Switch";
import { DisabledHint } from "@/components/common/DisabledHint";

import {
  fetchSchedule,
  fetchScheduleRuns,
  toggleSchedule,
  runScheduleNow,
  AUTO_DISABLE_THRESHOLD,
  type ScheduleRunRow,
} from "@/lib/api/schedules";
import { fetchRobots } from "@/lib/api/robots";
import { actionAvailability } from "@/lib/robot-actions";
import { formatAbsolute, formatRelative, formatDuration } from "@/lib/format";
import { errorText, errorTextByCode, toErrorObject, type ErrorObject } from "@/lib/errors";
import { toast, type Robot, type Schedule } from "@/stores";

const RUN_ROW_STATUS: Record<ScheduleRunRow["status"], { label: string; kind: "run" | "schedule" }> = {
  COMPLETED: { label: "COMPLETED", kind: "run" },
  FAILED: { label: "FAILED", kind: "run" },
  RUNNING: { label: "RUNNING", kind: "run" },
  SKIPPED_BUSY: { label: "SKIPPED", kind: "schedule" },
  SKIPPED_OFFLINE: { label: "SKIPPED", kind: "schedule" },
  MISFIRED: { label: "MISFIRED", kind: "schedule" },
};

export default function ScheduleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const scheduleId = (params?.scheduleId as string) ?? "";

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [runs, setRuns] = useState<ScheduleRunRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");
  const [error, setError] = useState<ErrorObject | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [runNowError, setRunNowError] = useState<ErrorObject | null>(null);
  const [runningNow, setRunningNow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchSchedule(scheduleId), fetchScheduleRuns(scheduleId), fetchRobots()])
      .then(([scheduleData, runData, robotData]) => {
        if (cancelled) return;
        if (!scheduleData) {
          setState("missing");
          return;
        }
        setSchedule(scheduleData);
        setRuns(runData);
        setRobots(robotData);
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
  }, [scheduleId, attempt]);

  const toggle = useCallback(async () => {
    if (!schedule) return;
    const next = !schedule.enabled;
    setSchedule({ ...schedule, enabled: next, consecutive_failures: next ? 0 : schedule.consecutive_failures });
    try {
      await toggleSchedule(schedule.id, next);
      toast.success(next ? "Đã bật lịch chạy." : "Đã tắt lịch chạy.");
    } catch (err) {
      setSchedule({ ...schedule });
      toast.error(errorText(toErrorObject(err)));
    }
  }, [schedule]);

  const runNow = useCallback(async () => {
    if (!schedule) return;
    setRunningNow(true);
    setRunNowError(null);
    try {
      const { run_id } = await runScheduleNow(schedule.id);
      toast.success("Đã bắt đầu chạy thử.");
      if (run_id) router.push(`/runs/${run_id}`);
    } catch (err) {
      setRunNowError(toErrorObject(err));
    } finally {
      setRunningNow(false);
    }
  }, [schedule, router]);

  if (state === "loading") {
    return (
      <div className="p-4 sm:p-6 max-w-[1024px] mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
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

  if (state === "missing" || !schedule) {
    return (
      <div className="p-6 max-w-[720px] mx-auto mt-10">
        <EmptyState
          message="Không tìm thấy lịch chạy này."
          action={
            <button type="button" onClick={() => router.push("/schedules")} className="btn-primary focus-ring">
              Về danh sách lịch
            </button>
          }
        />
      </div>
    );
  }

  const robot = robots.find((r) => r.id === schedule.robot_id);
  const autoDisabled = !schedule.enabled && schedule.consecutive_failures >= AUTO_DISABLE_THRESHOLD;
  const warning = schedule.consecutive_failures >= 3 && schedule.consecutive_failures < AUTO_DISABLE_THRESHOLD;
  const runNowAvailability = robot
    ? actionAvailability("runScheduleNow", robot.robot_status, robot.connection_status)
    : ({ state: "disabled", reason: "Robot của lịch này không còn tồn tại." } as const);

  return (
    <div className="p-4 sm:p-6 max-w-[1024px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-4">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={() => router.push("/schedules")}
            aria-label="Quay lại danh sách lịch"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-ink-800 hover:bg-ink-700 transition-colors duration-[120ms] focus-ring cursor-pointer shrink-0"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0">
            <h1 className="display-l text-paper-50 truncate">{schedule.name}</h1>
            <p className="eyebrow mt-1 flex flex-wrap gap-2">
              <span>{schedule.cron_description}</span>
              <span aria-hidden="true">·</span>
              {schedule.next_run_at && schedule.enabled && (
                <>
                  <span aria-hidden="true">·</span>
                  <span title={formatAbsolute(schedule.next_run_at)}>
                    Lần tới: {formatRelative(schedule.next_run_at)}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={schedule.enabled}
            onChange={toggle}
            label={schedule.enabled ? "Tắt lịch chạy" : "Bật lịch chạy"}
          />
          <DisabledHint reason={runNowAvailability.state === "disabled" ? runNowAvailability.reason : undefined}>
          <button
            type="button"
            onClick={runNow}
            disabled={runNowAvailability.state !== "enabled" || runningNow}
            title={runNowAvailability.state === "enabled" ? "Chạy lịch này ngay" : undefined}
            className="btn-primary focus-ring"
          >
            <Play size={14} />
            {runningNow ? "Đang chạy…" : "Chạy thử ngay"}
          </button>
          </DisabledHint>
        </div>
      </div>

      {/* Errors from Chạy thử stay next to the button, not in a toast */}
      {runNowError && (
        <p className="flex items-start gap-2 text-[13px] text-halt-500">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          {errorText(runNowError)}
        </p>
      )}

      {warning && (
        <div className="rounded-lg bg-amber-400/10 border border-amber-400/30 px-3 py-2.5 flex items-start gap-2 text-[13px] text-amber-400">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span>
            Lịch đã thất bại {schedule.consecutive_failures} lần liên tiếp. Sau {AUTO_DISABLE_THRESHOLD} lần hệ thống
            sẽ tự tắt.
          </span>
        </div>
      )}

      {autoDisabled && (
        <div className="rounded-lg bg-amber-400/10 border border-amber-400/30 px-3 py-2.5 flex items-center justify-between gap-3 text-[13px] text-amber-400">
          <span className="flex items-start gap-2">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            Hệ thống đã tự tắt lịch này sau {AUTO_DISABLE_THRESHOLD} lần thất bại liên tiếp.
          </span>
          <button
            type="button"
            onClick={toggle}
            className="btn-ghost !text-amber-400 hover:!bg-amber-400/10 border border-amber-400/30 focus-ring shrink-0"
          >
            Bật lại
          </button>
        </div>
      )}

      <section className="panel p-4">
        <h2 className="eyebrow mb-2">Nhiệm vụ</h2>
        <p className="body-text text-paper-50">{schedule.task_prompt}</p>
      </section>

      {/* Run history */}
      <section className="panel overflow-hidden">
        <h2 className="eyebrow px-4 py-3 border-b border-[var(--line)]">Lịch sử chạy</h2>

        {runs.length === 0 ? (
          <p className="p-6 text-[13px] text-haze-500 text-center">Lịch này chưa chạy lần nào.</p>
        ) : (
          <>
            {/* ≥768px: table */}
            <table className="w-full hidden md:table">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="eyebrow text-left px-4 py-2 font-medium">Dự kiến</th>
                  <th className="eyebrow text-left px-4 py-2 font-medium">Thực tế</th>
                  <th className="eyebrow text-left px-4 py-2 font-medium">Trạng thái</th>
                  <th className="eyebrow text-left px-4 py-2 font-medium">Thời lượng</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((row) => {
                  const clickable = row.run_id !== null;
                  const spec = RUN_ROW_STATUS[row.status];
                  return (
                    <tr
                      key={row.id}
                      onClick={clickable ? () => router.push(`/runs/${row.run_id}`) : undefined}
                      className={`border-b border-[var(--line)] last:border-0 ${
                        clickable ? "cursor-pointer hover:bg-ink-700" : "text-haze-500"
                      }`}
                    >
                      <td className="px-4 py-2.5 data text-[11.5px]" title={formatAbsolute(row.scheduled_at)}>
                        {formatAbsolute(row.scheduled_at)}
                      </td>
                      <td className="px-4 py-2.5 data text-[11.5px]">
                        {row.started_at ? formatAbsolute(row.started_at) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <StatusBadge kind={spec.kind} value={spec.label} />
                          {row.reason_code && (
                            <span
                              className="text-haze-500"
                              title={errorTextByCode(row.reason_code, "Không có thông tin lý do.")}
                            >
                              <Info size={13} />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 data text-[11.5px]">{formatDuration(row.duration_s)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* <768px: cards, no horizontal scrolling (MASTER §17) */}
            <ul className="md:hidden divide-y divide-[var(--line)]">
              {runs.map((row) => {
                const clickable = row.run_id !== null;
                const spec = RUN_ROW_STATUS[row.status];
                return (
                  <li key={row.id} className="p-4">
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={clickable ? () => router.push(`/runs/${row.run_id}`) : undefined}
                      className="w-full text-left disabled:cursor-default focus-ring rounded"
                    >
                      <span className="flex items-center justify-between gap-2 mb-1.5">
                        <StatusBadge kind={spec.kind} value={spec.label} />
                        <span className="data text-[11.5px] text-haze-500">{formatDuration(row.duration_s)}</span>
                      </span>
                      <span className="block eyebrow">Dự kiến</span>
                      <span className="block data text-[11.5px] mb-1">{formatAbsolute(row.scheduled_at)}</span>
                      {row.reason_code && (
                        <span className="block text-[12px] text-haze-500">
                          {errorTextByCode(row.reason_code, "Không có thông tin lý do.")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
