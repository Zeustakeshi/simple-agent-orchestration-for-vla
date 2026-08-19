/* Mock schedules — MASTER §19 */
import type { Schedule } from "@/stores";
import { mockDelay } from ".";

export const mockSchedules: Schedule[] = [
  {
    id: "sched-001",
    name: "Kiểm tra khay linh kiện sáng",
    description: "Kiểm tra và sắp xếp lại khay linh kiện vào đầu ca sáng",
    robot_id: "robot-001",
    task_prompt: "Kiểm tra khay linh kiện và sắp xếp lại theo màu.",
    cron_expression: "0 8 * * 1-5",
    cron_description: "Hàng ngày lúc 8:00 sáng, thứ Hai đến thứ Sáu",
    timezone: "Asia/Ho_Chi_Minh",
    enabled: true,
    overlap_policy: "SKIP",
    max_duration_s: 180,
    consecutive_failures: 0,
    next_run_at: "2026-08-12T01:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-11T01:00:00Z",
  },
  {
    id: "sched-002",
    name: "Calibration chiều",
    description: "Chạy calibration tự động vào cuối ca chiều",
    robot_id: "robot-001",
    task_prompt: "Chạy quy trình calibration toàn bộ khớp.",
    cron_expression: "0 17 * * 1-5",
    cron_description: "Hàng ngày lúc 17:00, thứ Hai đến thứ Sáu",
    timezone: "Asia/Ho_Chi_Minh",
    enabled: true,
    overlap_policy: "QUEUE",
    max_duration_s: 120,
    consecutive_failures: 1,
    next_run_at: "2026-08-11T10:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-10T10:00:00Z",
  },
  {
    id: "sched-003",
    name: "Kiểm tra chất lượng tự động",
    description: "Tự động kiểm tra chất lượng mẫu mỗi 2 giờ",
    robot_id: "robot-001",
    task_prompt: "Chụp ảnh và kiểm tra chất lượng mẫu đầu tiên trên khay.",
    cron_expression: "0 */2 * * *",
    cron_description: "Mỗi 2 giờ",
    timezone: "Asia/Ho_Chi_Minh",
    enabled: false,
    overlap_policy: "SKIP",
    max_duration_s: 300,
    consecutive_failures: 5,
    next_run_at: null,
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-08-09T04:00:00Z",
  },
];

/** The scheduler disables a job after this many consecutive failures. */
export const AUTO_DISABLE_THRESHOLD = 5;

export function fetchMockSchedules(): Promise<Schedule[]> {
  return mockDelay(mockSchedules, 0.03);
}

export function fetchMockSchedule(id: string): Promise<Schedule | undefined> {
  return mockDelay(mockSchedules.find((s) => s.id === id), 0.02);
}

/** PATCH /schedules/{id} { enabled } */
export function toggleMockSchedule(id: string, enabled: boolean): Promise<Schedule> {
  const schedule = mockSchedules.find((s) => s.id === id);
  if (!schedule) return Promise.reject({ code: "SCHED_004", message: "Không tìm thấy lịch." });
  schedule.enabled = enabled;
  if (enabled) schedule.consecutive_failures = 0;
  schedule.updated_at = new Date().toISOString();
  return mockDelay(schedule, 0.12);
}

/** DELETE /schedules/{id} */
export function deleteMockSchedule(id: string): Promise<void> {
  const index = mockSchedules.findIndex((s) => s.id === id);
  if (index === -1) return Promise.reject({ code: "SCHED_004", message: "Không tìm thấy lịch." });
  mockSchedules.splice(index, 1);
  return mockDelay(undefined, 0.05);
}

/** One row of GET /schedules/{id}/runs. Rows without a `run_id` were never
    executed (skipped or misfired) and are therefore not clickable (P08). */
export interface ScheduleRunRow {
  id: string;
  scheduled_at: string;
  started_at: string | null;
  status: "COMPLETED" | "FAILED" | "RUNNING" | "SKIPPED_BUSY" | "SKIPPED_OFFLINE" | "MISFIRED";
  duration_s: number | null;
  run_id: string | null;
  reason_code?: string;
}

export function fetchMockScheduleRuns(scheduleId: string): Promise<ScheduleRunRow[]> {
  const base = Date.now();
  const hour = 3600_000;
  return mockDelay(
    scheduleId
      ? [
          { id: "sr-1", scheduled_at: new Date(base - hour).toISOString(), started_at: new Date(base - hour).toISOString(), status: "COMPLETED" as const, duration_s: 96, run_id: "run-004" },
          { id: "sr-2", scheduled_at: new Date(base - 2 * hour).toISOString(), started_at: new Date(base - 2 * hour).toISOString(), status: "FAILED" as const, duration_s: 42, run_id: "run-002" },
          { id: "sr-3", scheduled_at: new Date(base - 3 * hour).toISOString(), started_at: null, status: "SKIPPED_BUSY" as const, duration_s: null, run_id: null, reason_code: "ROBOT_010" },
          { id: "sr-4", scheduled_at: new Date(base - 4 * hour).toISOString(), started_at: null, status: "SKIPPED_OFFLINE" as const, duration_s: null, run_id: null, reason_code: "ROBOT_011" },
          { id: "sr-5", scheduled_at: new Date(base - 5 * hour).toISOString(), started_at: new Date(base - 5 * hour).toISOString(), status: "COMPLETED" as const, duration_s: 88, run_id: "run-005" },
        ]
      : [],
    0.03,
  );
}

/** POST /schedules/{id}/run-now — refused when the robot is not idle. */
export function runMockScheduleNow(scheduleId: string): Promise<{ run_id: string }> {
  const schedule = mockSchedules.find((s) => s.id === scheduleId);
  if (!schedule) return Promise.reject({ code: "SCHED_004", message: "Không tìm thấy lịch." });
  if (!schedule.enabled) return Promise.reject({ code: "SCHED_020", message: "Lịch đang tắt." });
  return mockDelay({ run_id: `run-${Date.now().toString(36)}` }, 0.15);
}

/** POST /schedules — the server owns id, cron_description and next_run_at. */
export function createMockSchedule(input: {
  name: string;
  description: string;
  robot_id: string;
  task_prompt: string;
  cron_expression: string;
  cron_description: string;
  timezone: string;
  overlap_policy: Schedule["overlap_policy"];
  max_duration_s: number;
}): Promise<Schedule> {
  const now = new Date().toISOString();
  const schedule: Schedule = {
    ...input,
    id: `sched-${Date.now().toString(36)}`,
    enabled: true,
    consecutive_failures: 0,
    next_run_at: new Date(Date.now() + 3600_000).toISOString(),
    created_at: now,
    updated_at: now,
  };
  mockSchedules.unshift(schedule);
  return mockDelay(schedule, 0.08);
}

export interface CronValidation {
  valid: boolean;
  /** Server-authored message; the client never re-implements cron rules. */
  message?: string;
  code?: string;
  cron_description?: string;
  next_5_runs_local?: string[];
}

/** POST /schedules/validate-cron
    All cron semantics live on the server (P07): the client only relays. */
export function validateMockCron(expression: string, timezone: string): Promise<CronValidation> {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return mockDelay(
      { valid: false, code: "SCHED_002", message: "Biểu thức cron phải có đúng 5 trường." },
      0,
    );
  }
  if (!/^[\d*/,\-\s]+$/.test(expression)) {
    return mockDelay({ valid: false, code: "SCHED_002", message: "Biểu thức cron chứa ký tự không hợp lệ." }, 0);
  }

  const base = Date.now();
  return mockDelay(
    {
      valid: true,
      cron_description: describeCron(fields),
      next_5_runs_local: Array.from({ length: 5 }, (_, i) =>
        new Date(base + (i + 1) * 3600_000).toLocaleString("vi-VN", { timeZone: timezone }),
      ),
    },
    0,
  );
}

/** Plain-Vietnamese rendering of the common shapes — the server is the
    authority; this mirrors what it would return. */
function describeCron(fields: string[]): string {
  const [minute, hour, dayOfMonth, , dayOfWeek] = fields;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

  if (hour.startsWith("*/")) return `Mỗi ${hour.slice(2)} giờ`;
  if (hour === "*") return `Mỗi giờ, phút thứ ${minute}`;
  if (dayOfWeek !== "*") {
    const days = dayOfWeek
      .split(",")
      .flatMap((token) => {
        const [from, to] = token.split("-").map(Number);
        if (to === undefined) return Number.isNaN(from) ? [] : [WEEKDAYS[from % 7]];
        return Array.from({ length: to - from + 1 }, (_, i) => WEEKDAYS[(from + i) % 7]);
      })
      .join(", ");
    return `${days} lúc ${time}`;
  }
  if (dayOfMonth !== "*") return `Ngày ${dayOfMonth} hàng tháng lúc ${time}`;
  return `Mỗi ngày lúc ${time}`;
}
