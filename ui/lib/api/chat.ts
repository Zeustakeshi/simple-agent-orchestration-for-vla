import { apiRequest } from "./client";
import { toErrorObject, type ErrorObject } from "@/lib/errors";
import type { RunStatus } from "@/stores";

export interface ChatRequest {
  message: string;
  robot_id?: string;
  session_id?: string | null;
}

export interface ChatResponse {
  response: string;
  run_id: string;
  trace_id: string;
  status: RunStatus;
  duration_ms: number | null;
  error: ErrorObject | null;
}

interface ChatResponsePayload extends Omit<ChatResponse, "error"> {
  error?: unknown;
}

/** Map UI robot picker ids to Cloud agent robot_id (mock edge for now). */
export function toAgentRobotId(uiRobotId: string | null | undefined): string {
  if (!uiRobotId) return "robot_mock";
  // Mock fleet ids → single cloud mock robot until Edge registry is real.
  if (uiRobotId.startsWith("robot-") || uiRobotId.startsWith("robot_")) {
    return "robot_mock";
  }
  return uiRobotId;
}

export interface ChatStartResponse {
  run_id: string;
  trace_id: string;
  session_id: string;
}

/** Mở lượt chạy và trả `run_id` NGAY, agent chạy nền.
 *
 * Khác `postChat` ở đúng chỗ quyết định: `postChat` chỉ trả lời khi agent đã
 * xong, nên trong lúc nó chạy không có gì để hiện — mọi hành động của agent
 * đến cùng một lúc, lúc đã quá muộn. Có `run_id` sớm thì mới đăng ký được
 * `/runs/{id}/stream` và xem agent làm việc theo thời gian thật. */
export async function startChat(
  payload: ChatRequest,
  options?: { signal?: AbortSignal },
): Promise<ChatStartResponse> {
  return apiRequest<ChatStartResponse>("/api/v1/chat/start", {
    method: "POST",
    body: {
      message: payload.message,
      robot_id: toAgentRobotId(payload.robot_id),
      session_id: payload.session_id ?? null,
    },
    signal: options?.signal,
  });
}

export async function postChat(
  payload: ChatRequest,
  options?: { signal?: AbortSignal },
): Promise<ChatResponse> {
  // FastAPI returns ChatResponse at the top level (not envelope).
  const result = await apiRequest<ChatResponsePayload>("/api/v1/chat", {
    method: "POST",
    body: {
      message: payload.message,
      robot_id: toAgentRobotId(payload.robot_id),
      session_id: payload.session_id ?? null,
    },
    signal: options?.signal,
  });

  return {
    ...result,
    error: result.error ? toErrorObject(result.error) : null,
  };
}
