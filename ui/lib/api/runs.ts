import type { Run, RunSource, RunStatus } from "@/stores";
import { fetchMockRun, fetchMockRuns, legacyRunToSummary } from "@/lib/mock/runs";
import { apiRequest } from "./client";
import { USE_MOCK } from "./config";

export interface RunSummary {
  id: string;
  trace_id: string;
  session_id: string;
  robot_id: string;
  user_id: string;
  schedule_id?: string | null;
  source: RunSource;
  status: RunStatus;
  input_text: string;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  duration_s?: number | null;
  error: Record<string, unknown> | null;
}

export interface RunDetail extends RunSummary {
  final_response: string | null;
  outcome: string | null;
  events_dropped: number;
  episodes?: Run["episodes"];
  schedule_id?: string | null;
}

export interface TraceEvent {
  id: string;
  run_id: string;
  trace_id: string;
  sequence: number;
  timestamp: string;
  type: string;
  status: string | null;
  duration_ms: number | null;
  model: string | null;
  tool_name: string | null;
  arguments: Record<string, unknown> | null;
  result_summary: unknown;
  error: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface PaginatedRuns {
  items: RunSummary[];
  total: number;
}

export interface ListRunsParams {
  limit?: number;
  offset?: number;
  status?: RunStatus;
  source?: RunSource;
  session_id?: string;
  robot_id?: string;
}

type RunsListPayload = PaginatedRuns | RunSummary[];

function normalizeSummary(run: RunSummary | Run): RunSummary {
  const durationMs =
    "duration_ms" in run && typeof run.duration_ms === "number"
      ? run.duration_ms
      : typeof run.duration_s === "number"
        ? run.duration_s * 1000
        : null;
  return {
    id: run.id,
    trace_id: run.trace_id,
    session_id: run.session_id,
    robot_id: run.robot_id,
    user_id: "user_id" in run && typeof run.user_id === "string" ? run.user_id : "user_dev",
    source: run.source,
    status: run.status,
    input_text: run.input_text,
    created_at: run.created_at,
    completed_at: run.completed_at,
    duration_ms: durationMs,
    duration_s: "duration_s" in run ? run.duration_s : durationMs === null ? null : durationMs / 1000,
    error: run.error ?? null,
  };
}

function normalizeDetail(run: RunDetail | Run): RunDetail {
  return {
    ...normalizeSummary(run),
    final_response: "final_response" in run ? run.final_response : null,
    outcome: run.outcome ?? null,
    events_dropped: "events_dropped" in run ? run.events_dropped : 0,
    episodes: "episodes" in run ? run.episodes : [],
    schedule_id: "schedule_id" in run ? run.schedule_id : null,
  };
}

function toRun(summary: RunSummary): Run {
  return {
    id: summary.id,
    session_id: summary.session_id,
    schedule_id: "schedule_id" in summary ? summary.schedule_id : null,
    robot_id: summary.robot_id,
    status: summary.status,
    source: summary.source,
    input_text: summary.input_text,
    created_at: summary.created_at,
    completed_at: summary.completed_at,
    duration_s:
      typeof summary.duration_s === "number"
        ? summary.duration_s
        : summary.duration_ms === null
          ? null
          : summary.duration_ms / 1000,
    trace_id: summary.trace_id,
    outcome: "outcome" in summary && typeof summary.outcome === "string" ? summary.outcome : undefined,
    error: summary.error as Run["error"],
    episodes: "episodes" in summary && Array.isArray(summary.episodes) ? summary.episodes : [],
  };
}

export async function listRuns(
  params?: ListRunsParams,
  options?: { signal?: AbortSignal },
): Promise<PaginatedRuns> {
  if (USE_MOCK) {
    const summaries = (await fetchMockRuns()).map(legacyRunToSummary).map(normalizeSummary);
    const filtered = summaries.filter((run) => {
      if (params?.robot_id && run.robot_id !== params.robot_id) return false;
      if (params?.status && run.status !== params.status) return false;
      if (params?.source && run.source !== params.source) return false;
      if (params?.session_id && run.session_id !== params.session_id) return false;
      return true;
    });
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 50;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  }

  const searchParams = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  const payload = await apiRequest<RunsListPayload>(`/api/v1/runs${query ? `?${query}` : ""}`, {
    method: "GET",
    signal: options?.signal,
  });
  if (Array.isArray(payload)) {
    return { items: payload.map(normalizeSummary), total: payload.length };
  }
  return {
    items: payload.items.map(normalizeSummary),
    total: payload.total,
  };
}

export async function getRun(
  runId: string,
  options?: { signal?: AbortSignal },
): Promise<RunDetail> {
  const payload = await apiRequest<RunDetail | Run>(`/api/v1/runs/${encodeURIComponent(runId)}`, {
    method: "GET",
    signal: options?.signal,
  });
  return normalizeDetail(payload);
}

export async function getRunTimeline(
  runId: string,
  options?: { signal?: AbortSignal },
): Promise<TraceEvent[]> {
  return apiRequest<TraceEvent[]>(`/api/v1/runs/${encodeURIComponent(runId)}/timeline`, {
    method: "GET",
    signal: options?.signal,
  });
}

export async function fetchRuns(params?: {
  robot_id?: string;
  status?: string;
  source?: string;
  has_error?: boolean;
}): Promise<Run[]> {
  if (USE_MOCK) {
    const rows = await fetchMockRuns();
    return rows.filter((run) => {
      if (params?.robot_id && run.robot_id !== params.robot_id) return false;
      if (params?.status) {
        const wanted = params.status.split(",").filter(Boolean);
        if (wanted.length && !wanted.includes(run.status)) return false;
      }
      if (params?.source) {
        const wanted = params.source.split(",").filter(Boolean);
        if (wanted.length && !wanted.includes(run.source)) return false;
      }
      if (params?.has_error && !run.error) return false;
      return true;
    });
  }
  const search = new URLSearchParams();
  if (params?.robot_id) search.set("robot_id", params.robot_id);
  if (params?.status) search.set("status", params.status);
  if (params?.source) search.set("source", params.source);
  if (params?.has_error) search.set("has_error", "true");
  const suffix = search.toString() ? `?${search.toString()}` : "";
  const payload = await apiRequest<RunSummary[]>(`/api/v1/runs${suffix}`);
  return payload.map((run) => toRun(normalizeSummary(run)));
}

export async function fetchRun(runId: string): Promise<Run | null> {
  if (USE_MOCK) return (await fetchMockRun(runId)) ?? null;
  try {
    return toRun(await getRun(runId));
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}
