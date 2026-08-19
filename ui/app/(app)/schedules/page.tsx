"use client";
/* P07 — LỊCH CHẠY
   The list speaks plain Vietnamese: `cron_description`, never the raw cron
   string (that only appears in the form's advanced mode). Toggling is
   optimistic with rollback; a schedule the system auto-disabled after 5
   consecutive failures is marked with an amber left border. */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, MoreHorizontal, Play, Pencil, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/common/EmptyState";
import { ErrorPanel } from "@/components/common/ErrorMessage";
import { ConfirmDialog } from "@/components/common/Dialog";
import { Switch } from "@/components/common/Switch";
import { DisabledHint } from "@/components/common/DisabledHint";
import { Skeleton } from "@/components/common/Skeleton";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ScheduleForm } from "@/components/schedule/ScheduleForm";

import {
  fetchSchedules,
  toggleSchedule,
  deleteSchedule,
  AUTO_DISABLE_THRESHOLD,
} from "@/lib/api/schedules";
import { fetchRobots } from "@/lib/api/robots";
import { actionAvailability } from "@/lib/robot-actions";
import { useDismissable } from "@/hooks/useDismissable";
import { formatRelative, formatAbsolute } from "@/lib/format";
import { errorText, toErrorObject, type ErrorObject } from "@/lib/errors";
import { toast, type Schedule, type Robot } from "@/stores";

function ScheduleCard({
  schedule,
  robots,
  onToggle,
  onDelete,
}: {
  schedule: Schedule;
  robots: Robot[];
  onToggle: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissable(menuOpen, menuRef, useCallback(() => setMenuOpen(false), []));
  /* Robot đến từ PROP chứ không tra `mockRobots` trong bundle: danh sách thật
     nạp bất đồng bộ ở trang cha, và tra mảng tĩnh thì mọi lịch đều báo "Robot
     của lịch này không còn tồn tại" khi chạy dữ liệu thật. */
  const robot = robots.find((r) => r.id === schedule.robot_id);
  const autoDisabled = !schedule.enabled && schedule.consecutive_failures >= AUTO_DISABLE_THRESHOLD;

  const runNow = robot
    ? actionAvailability("runScheduleNow", robot.robot_status, robot.connection_status)
    : ({ state: "disabled", reason: "Robot của lịch này không còn tồn tại." } as const);

  return (
    <article
      /* z-30 khi menu mở: .panel có backdrop-filter nên mỗi thẻ là một stacking
         context riêng — z-index của menu chỉ có tác dụng BÊN TRONG thẻ, còn thẻ
         phía dưới (anh em sau trong DOM) vẫn vẽ đè lên. Phải nâng chính thẻ. */
      className={`panel p-4 grid grid-cols-[1fr_auto] gap-3 ${menuOpen ? "z-30" : ""} ${
        autoDisabled ? "border-l-2 border-l-amber-400" : ""
      } ${schedule.enabled ? "" : "opacity-80"}`}
    >
      <div className="min-w-0">
        <Link
          href={`/schedules/${schedule.id}`}
          className="title text-[16px] hover:text-arc-400 transition-colors duration-[120ms] focus-ring rounded block truncate"
        >
          {schedule.name}
        </Link>
        <p className="text-[13px] text-haze-300 mt-1">{schedule.cron_description}</p>
        <p className="eyebrow mt-2 flex flex-wrap gap-2">
          {schedule.next_run_at && schedule.enabled && (
            <>
              <span title={formatAbsolute(schedule.next_run_at)}>Lần tới: {formatRelative(schedule.next_run_at)}</span>
            </>
          )}
        </p>
        {autoDisabled && (
          <p className="text-[12.5px] text-amber-400 mt-2">
            Đã tự tắt sau {AUTO_DISABLE_THRESHOLD} lần thất bại liên tiếp.
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <Switch
          checked={schedule.enabled}
          onChange={() => onToggle(schedule)}
          label={`${schedule.enabled ? "Tắt" : "Bật"} lịch ${schedule.name}`}
        />

        <StatusBadge kind="schedule" value={autoDisabled ? "AUTO_DISABLED" : schedule.enabled ? "ENABLED" : "DISABLED"} />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`Tuỳ chọn cho ${schedule.name}`}
            aria-expanded={menuOpen}
            className="p-1.5 rounded-lg text-haze-500 hover:text-paper-50 hover:bg-ink-700 transition-colors duration-[120ms] focus-ring cursor-pointer"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-20 w-48 menu-surface py-1">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  router.push(`/schedules/${schedule.id}`);
                }}
                className="w-full flex items-center gap-2 px-3 h-9 text-[13px] text-haze-300 hover:text-paper-50 hover:bg-ink-700 focus-ring cursor-pointer"
              >
                <Pencil size={13} /> Sửa
              </button>
              <DisabledHint reason={runNow.state === "disabled" ? runNow.reason : undefined}>
              <button
                type="button"
                disabled={runNow.state !== "enabled"}
                title={undefined}
                onClick={() => {
                  setMenuOpen(false);
                  toast.success("Đã yêu cầu chạy thử.");
                }}
                className="w-full flex items-center gap-2 px-3 h-9 text-[13px] text-haze-300 hover:text-paper-50 hover:bg-ink-700 disabled:opacity-40 disabled:cursor-not-allowed focus-ring cursor-pointer"
              >
                <Play size={13} /> Chạy thử ngay
              </button>
              </DisabledHint>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(schedule);
                }}
                className="w-full flex items-center gap-2 px-3 h-9 text-[13px] text-halt-500 hover:bg-halt-500/10 focus-ring cursor-pointer"
              >
                <Trash2 size={13} /> Xoá
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/* Thứ tự cố định, không có nút sắp xếp — và sắp theo GIỜ TRONG NGÀY, kiểu danh
   sách báo thức, chứ không theo lần chạy kế tiếp.

   Sắp theo lần chạy kế tiếp nghe có vẻ đúng hơn, nhưng nó làm danh sách tự xáo
   lại suốt ngày: hai lịch 08:00 và 17:00, lúc 9 giờ sáng thì 17:00 đứng đầu,
   qua 18 giờ thì 08:00 lên đầu. Cùng hai lịch không đổi gì mà mỗi lúc mở ra
   thấy một thứ tự — mất luôn trí nhớ vị trí.

   Lịch chạy là việc LẶP LẠI, nên thứ nhận dạng nó là mốc giờ chứ không phải
   lần chạy sắp tới. "Cái 8 giờ sáng" luôn nằm trên "cái 5 giờ chiều", y như
   báo thức trên điện thoại.

   Ba bậc, trong mỗi bậc mới xét tới giờ:
     1. đang bật · 2. tự tắt sau 5 lần lỗi (cần xử lý) · 3. tắt tay
*/
function scheduleRank(schedule: Schedule): number {
  if (schedule.enabled) return 0;
  return schedule.consecutive_failures >= AUTO_DISABLE_THRESHOLD ? 1 : 2;
}

/** Rút mốc giờ trong ngày từ cron, tính bằng phút. Trả `null` khi cron chạy
    theo chu kỳ — loại đó không có mốc giờ nào để mà xếp. */
function timeOfDayMinutes(cronExpression: string): number | null {
  const [minuteField, hourField] = cronExpression.trim().split(/\s+/);
  if (!minuteField || !hourField) return null;
  // Chu kỳ hoặc mọi giờ → không có mốc cố định.
  if (hourField.includes("*") || hourField.includes("/")) return null;
  // Danh sách "8,17" thì lấy mốc đầu tiên trong ngày.
  const hour = Number(hourField.split(",")[0]);
  const minute = Number(minuteField.split(",")[0]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function sortSchedules(list: Schedule[]): Schedule[] {
  return [...list].sort((a, b) => {
    const rank = scheduleRank(a) - scheduleRank(b);
    if (rank !== 0) return rank;

    const at = timeOfDayMinutes(a.cron_expression);
    const bt = timeOfDayMinutes(b.cron_expression);
    // Lịch chạy theo chu kỳ không có mốc giờ — dồn xuống cuối bậc thay vì lẫn
    // vào giữa các lịch có giờ rõ ràng.
    if (at === null && bt === null) return a.name.localeCompare(b.name, "vi");
    if (at === null) return 1;
    if (bt === null) return -1;
    if (at !== bt) return at - bt;
    return a.name.localeCompare(b.name, "vi");
  });
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  /* Danh sách robot nạp SONG SONG, và lỗi của nó KHÔNG làm hỏng trang: thiếu
     robot thì mỗi thẻ lịch tự hiện lý do không chạy được, còn danh sách lịch
     vẫn đọc được bình thường (§14.3 — mỗi vùng tự lo trạng thái của nó). */
  const [robots, setRobots] = useState<Robot[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<ErrorObject | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Schedule | null>(null);

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
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;
    fetchSchedules()
      .then((data) => {
        if (cancelled) return;
        setSchedules(data);
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

  const toggle = useCallback(async (schedule: Schedule) => {
    const next = !schedule.enabled;
    setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, enabled: next } : s)));
    try {
      await toggleSchedule(schedule.id, next);
      toast.success(next ? "Đã bật lịch chạy." : "Đã tắt lịch chạy.");
    } catch (err) {
      // Rollback — the switch must never lie about server state.
      setSchedules((prev) => prev.map((s) => (s.id === schedule.id ? { ...s, enabled: !next } : s)));
      toast.error(errorText(toErrorObject(err)));
    }
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteSchedule(target.id);
      setSchedules((prev) => prev.filter((s) => s.id !== target.id));
      toast.success("Đã xoá lịch chạy.");
    } catch (err) {
      toast.error(errorText(toErrorObject(err)));
    }
  }, [pendingDelete]);

  return (
    <div className="p-4 sm:p-6 max-w-[1440px] mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="display-l text-paper-50">Lịch chạy</h1>
        <button type="button" onClick={() => setFormOpen(true)} className="btn-primary focus-ring">
          <Plus size={15} />
          Tạo lịch chạy
        </button>
      </div>

      {state === "loading" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[148px] rounded-xl" />
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
        (schedules.length === 0 ? (
          <EmptyState
            message="Chưa có lịch chạy nào. Tạo một lịch để robot tự làm việc theo giờ."
            action={
              <button type="button" onClick={() => setFormOpen(true)} className="btn-primary focus-ring">
                Tạo lịch chạy
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {sortSchedules(schedules).map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                robots={robots}
                onToggle={toggle}
                onDelete={setPendingDelete}
              />
            ))}
          </div>
        ))}

      {formOpen && (
        <ScheduleForm
          onClose={() => setFormOpen(false)}
          onSaved={(created) => {
            setSchedules((prev) => [created, ...prev]);
            setFormOpen(false);
            toast.success("Đã tạo lịch chạy.");
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Xoá lịch chạy?"
        description={`Lịch "${pendingDelete?.name ?? ""}" sẽ bị xoá và không còn tự chạy nữa.`}
        confirmLabel="Xoá lịch"
      />
    </div>
  );
}
