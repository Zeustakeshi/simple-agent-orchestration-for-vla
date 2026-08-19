/* Cloud session CRUD, with a sessionStorage fallback used only by the
   control-room transcript when the list API is unreachable. */

import type { Message, Session } from "@/stores";
import { apiClient } from "./client";
import { getRunTimeline, type TraceEvent } from "./runs";
import { traceEventsToAgentSteps, traceEventsToToolCalls } from "./run-timeline";
import { USE_MOCK } from "./config";
import {
  createMockSession,
  deleteMockSession,
  fetchMockMessages,
  fetchMockSessions,
  pinMockSession,
  renameMockSession,
} from "@/lib/mock/sessions";

export function newSessionHref(robotId?: string | null): string {
  const params = new URLSearchParams({ new: "1" });
  if (robotId) params.set("robot_id", robotId);
  return `/control/new?${params.toString()}`;
}

const SESSIONS_KEY = "cloudagent.sessions.v1";
const MESSAGES_KEY = "cloudagent.messages.v1";

type SessionMap = Record<string, Session>;
type MessageMap = Record<string, Message[]>;

function readSessions(): SessionMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(SESSIONS_KEY) ?? "{}") as SessionMap;
  } catch {
    return {};
  }
}

function writeSessions(map: SessionMap) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(SESSIONS_KEY, JSON.stringify(map));
}

function readMessages(): MessageMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(MESSAGES_KEY) ?? "{}") as MessageMap;
  } catch {
    return {};
  }
}

function writeMessages(map: MessageMap) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(map));
}

export async function fetchSessions(params?: {
  q?: string;
  robot_id?: string;
  include_hidden?: boolean;
}): Promise<Session[]> {
  if (USE_MOCK) {
    const rows = await fetchMockSessions();
    const query = (params?.q ?? "").trim().toLowerCase();
    return rows.filter((session) => {
      if (params?.robot_id && session.robot_id !== params.robot_id) return false;
      if (!params?.include_hidden && session.title === "Phiên tự động") return false;
      if (session.title === "Phiên mới" && !session.last_message_preview && !session.active_run) {
        return false;
      }
      if (!query) return true;
      return (
        session.title.toLowerCase().includes(query) ||
        (session.last_message_preview ?? "").toLowerCase().includes(query)
      );
    });
  }
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.robot_id) search.set("robot_id", params.robot_id);
  if (params?.include_hidden) search.set("include_hidden", "true");
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return apiClient.get<Session[]>(`/api/v1/sessions${suffix}`);
}

export async function fetchLatestSession(robotId?: string): Promise<Session | null> {
  if (USE_MOCK) {
    const rows = await fetchMockSessions();
    const filtered = rows
      .filter((s) => s.title !== "Phiên tự động")
      .filter((s) => !robotId || s.robot_id === robotId)
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return filtered[0] ?? null;
  }
  try {
    const suffix = robotId ? `?robot_id=${encodeURIComponent(robotId)}` : "";
    return await apiClient.get<Session>(`/api/v1/sessions/latest${suffix}`);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

export async function createSession(robotId: string): Promise<Session> {
  if (USE_MOCK) return createMockSession(robotId);
  return apiClient.post<Session>("/api/v1/sessions", { robot_id: robotId });
}

export async function renameSession(sessionId: string, title: string): Promise<Session> {
  if (USE_MOCK) return renameMockSession(sessionId, title);
  return apiClient.patch<Session>(`/api/v1/sessions/${sessionId}`, { title });
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (USE_MOCK) return deleteMockSession(sessionId);
  await apiClient.delete(`/api/v1/sessions/${sessionId}`);
}

/** Ghim phiên lên đầu danh sách.
 *
 * Lưu ở BACKEND chứ không phải `localStorage`: ghim là dữ liệu của người dùng,
 * không phải tuỳ chọn giao diện (§18.2) — đổi máy hay đổi trình duyệt thì phiên
 * đã ghim vẫn phải còn đó. */
export async function pinSession(sessionId: string, pinned: boolean): Promise<Session> {
  if (USE_MOCK) return pinMockSession(sessionId, pinned);
  return apiClient.patch<Session>(`/api/v1/sessions/${sessionId}`, { pinned });
}

export async function fetchSession(sessionId: string): Promise<Session | null> {
  if (USE_MOCK) {
    return (await fetchMockSessions()).find((s) => s.id === sessionId) ?? null;
  }
  try {
    return await apiClient.get<Session>(`/api/v1/sessions/${sessionId}`);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

export async function fetchMessages(sessionId: string): Promise<Message[]> {
  if (USE_MOCK) return fetchMockMessages(sessionId);

  const rows = await apiClient.get<(Message & { run_id?: string | null })[]>(
    `/api/v1/sessions/${sessionId}/messages`,
  );

  /* Dựng lại chặng đường agent cho từng tin nhắn assistant.
   *
   * Backend không lưu `agent_steps`/`tool_calls` cùng tin nhắn — chúng sống
   * trong kho sự kiện trace, đánh chỉ mục theo `run_id`. Không lấy về thì mở
   * lại một phiên cũ chỉ còn chữ, và toàn bộ việc agent đã làm biến mất.
   *
   * Đọc từ kho sự kiện chứ không nhân bản sang bảng tin nhắn: cùng nguồn với
   * trang Nhật ký, nên hai nơi không thể kể hai câu chuyện khác nhau.
   *
   * Chạy SONG SONG và nuốt lỗi từng cái: một lượt chạy cũ đã bị dọn trace thì
   * tin nhắn đó mất phần chặng đường, các tin còn lại không việc gì. */
  const runIds = [
    ...new Set(
      rows
        .filter((m) => m.role === "assistant" && m.run_id)
        .map((m) => m.run_id as string),
    ),
  ];
  if (runIds.length === 0) return rows;

  const traces = new Map<string, TraceEvent[]>();
  await Promise.all(
    runIds.map(async (runId) => {
      try {
        traces.set(runId, await getRunTimeline(runId));
      } catch {
        /* lượt chạy không còn trace — bỏ qua, tin nhắn vẫn hiện chữ */
      }
    }),
  );

  return rows.map((m) => {
    /* CHỈ tin nhắn assistant. Tin nhắn của người dùng mang CÙNG `run_id` — nó
       chính là câu lệnh mở ra lượt chạy đó — nên thiếu điều kiện vai trò thì
       khối trace mọc luôn trong bong bóng xanh của người dùng, kể lại chặng
       đường agent bên trong câu người ta vừa gõ. */
    const events = m.role === "assistant" && m.run_id ? traces.get(m.run_id) : undefined;
    if (!events || events.length === 0) return m;
    return {
      ...m,
      agent_steps: traceEventsToAgentSteps(events),
      tool_calls: traceEventsToToolCalls(events),
    };
  });
}

export function createLocalSession(robotId: string): Session {
  const id = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return ensureLocalSession(id, robotId || "robot_mock");
}

export function ensureLocalSession(sessionId: string, robotId: string): Session {
  const existing = getLocalSession(sessionId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const session: Session = {
    id: sessionId,
    title: "Phiên mới",
    robot_id: robotId || "robot_mock",
    created_at: now,
    updated_at: now,
    active_run: null,
    last_message_preview: null,
    /* Phiên mới chưa bao giờ được ghim. Trường này là dữ liệu người dùng chứ
       không phải tuỳ chọn giao diện, nên nó bắt buộc có mặt trong `Session`. */
    pinned: false,
  };
  const map = readSessions();
  map[sessionId] = session;
  writeSessions(map);
  return session;
}

export function getLocalSession(sessionId: string): Session | null {
  return readSessions()[sessionId] ?? null;
}

export function listLocalSessions(): Session[] {
  return Object.values(readSessions()).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function loadLocalMessages(sessionId: string): Message[] {
  return readMessages()[sessionId] ?? [];
}

export function saveLocalMessages(sessionId: string, messages: Message[]) {
  const map = readMessages();
  map[sessionId] = messages;
  writeMessages(map);

  const sessions = readSessions();
  const session = sessions[sessionId];
  if (session) {
    const last = [...messages].reverse().find((m) => m.role === "user" || m.role === "assistant");
    session.updated_at = new Date().toISOString();
    session.last_message_preview = last?.content?.slice(0, 120) ?? null;
    if (last?.role === "user" && (!session.title || session.title === "Phiên mới")) {
      session.title = last.content.slice(0, 48) || "Phiên mới";
    }
    sessions[sessionId] = session;
    writeSessions(sessions);
  }
}
