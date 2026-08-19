import type { Schedule } from "@/stores";
import { apiClient } from "./client";
import { USE_MOCK } from "./config";
import {
  AUTO_DISABLE_THRESHOLD,
  createMockSchedule,
  deleteMockSchedule,
  fetchMockSchedule,
  fetchMockScheduleRuns,
  fetchMockSchedules,
  runMockScheduleNow,
  toggleMockSchedule,
  validateMockCron,
  type CronValidation,
  type ScheduleRunRow,
} from "@/lib/mock/schedules";

export { AUTO_DISABLE_THRESHOLD };
export type { CronValidation, ScheduleRunRow };

export async function fetchSchedules(params?: { enabled?: boolean; limit?: number }): Promise<Schedule[]> {
  if (USE_MOCK) return fetchMockSchedules();
  const query = new URLSearchParams();
  if (params?.enabled !== undefined) query.set("enabled", String(params.enabled));
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiClient.get<Schedule[]>(`/api/v1/schedules${suffix}`);
}

export async function fetchSchedule(id: string): Promise<Schedule | undefined> {
  if (USE_MOCK) return fetchMockSchedule(id);
  try {
    return await apiClient.get<Schedule>(`/api/v1/schedules/${id}`);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function toggleSchedule(id: string, enabled: boolean): Promise<Schedule> {
  if (USE_MOCK) return toggleMockSchedule(id, enabled);
  return apiClient.patch<Schedule>(`/api/v1/schedules/${id}`, { enabled });
}

export async function deleteSchedule(id: string): Promise<void> {
  if (USE_MOCK) return deleteMockSchedule(id);
  await apiClient.delete(`/api/v1/schedules/${id}`);
}

export async function fetchScheduleRuns(scheduleId: string): Promise<ScheduleRunRow[]> {
  if (USE_MOCK) return fetchMockScheduleRuns(scheduleId);
  return apiClient.get<ScheduleRunRow[]>(`/api/v1/schedules/${scheduleId}/runs`);
}

export async function runScheduleNow(scheduleId: string): Promise<{ run_id: string }> {
  if (USE_MOCK) return runMockScheduleNow(scheduleId);
  return apiClient.post<{ run_id: string }>(`/api/v1/schedules/${scheduleId}/run-now`);
}

export async function createSchedule(input: {
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
  if (USE_MOCK) return createMockSchedule(input);
  return apiClient.post<Schedule>("/api/v1/schedules", input);
}

export async function validateCron(expression: string, timezone: string): Promise<CronValidation> {
  if (USE_MOCK) return validateMockCron(expression, timezone);
  return apiClient.post<CronValidation>("/api/v1/schedules/validate-cron", { expression, timezone });
}
