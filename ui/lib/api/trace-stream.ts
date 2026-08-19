/* trace-stream — đọc `GET /api/v1/runs/{run_id}/stream` theo thời gian thật.
 *
 * Chỉ lo phần I/O: mở kết nối, gắn token, cắt khối SSE, làm mới token khi hết
 * hạn giữa chừng. Việc dịch sự kiện nằm ở `trace-translate.ts` — tách ra để
 * phần dịch kiểm được bằng script Node trên payload thật.
 *
 * DÙNG `fetch` + ReadableStream, KHÔNG dùng `EventSource`. `EventSource` không
 * gắn được header nên không gửi nổi `Authorization: Bearer` — mà stream này bắt
 * buộc xác thực. Đây cũng đúng hướng đã ghi sẵn trong `useSessionStream` (P04 §9).
 */

import { API_BASE } from "./config";
import { refreshAccessToken } from "./client";
import { getAccessToken } from "./token-store";
import type { SseEvent } from "@/lib/mock/sse";
import { traceEventToSse, isTerminalTrace, type TracePayload } from "./trace-translate";

interface StreamOptions {
  runId: string;
  signal: AbortSignal;
  onEvent: (event: SseEvent) => void;
  /** Gọi đúng một lần khi lượt chạy kết thúc, kèm payload cuối. */
  onTerminal: (payload: TracePayload) => void;
}

function parseData(block: string): TracePayload | null {
  /* Một khối SSE gồm nhiều dòng `field: value`; chỉ `data:` là nội dung. Nối
     các dòng `data:` lại bằng "\n" đúng như đặc tả — payload JSON có thể trải
     nhiều dòng. */
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    return JSON.parse(data) as TracePayload;
  } catch {
    return null;
  }
}

/** Đọc luồng tới khi lượt chạy kết thúc hoặc `signal` huỷ. */
export async function streamRunTrace({ runId, signal, onEvent, onTerminal }: StreamOptions): Promise<void> {
  const path = `${API_BASE}/api/v1/runs/${encodeURIComponent(runId)}/stream`;

  const open = async (token: string | null) =>
    fetch(path, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      signal,
    });

  let res = await open(getAccessToken());
  /* Token hết hạn giữa chừng là chuyện thường: access token sống 900s còn một
     lượt chạy robot có thể lâu hơn thế. Làm mới rồi mở lại đúng một lần. */
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await open(refreshed);
  }
  if (!res.ok || !res.body) {
    throw new Error(`Không mở được luồng trace (HTTP ${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  /* Sổ theo dõi các lời gọi tool đang mở, theo TÊN tool. Chỉ dùng khi sự kiện
     kết thúc quên gửi `id` — xem lý do ở `traceEventToSse`. Trạng thái này nằm
     ở tầng I/O nên phần dịch vẫn thuần và test được. */
  const openTools = new Map<string, string>();
  const resolveOpenToolId = (toolName: string) => openTools.get(toolName);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      /* Khối SSE ngăn nhau bằng dòng trống. Giữ phần đuôi chưa trọn vẹn lại
         trong buffer — một khối có thể bị cắt làm đôi giữa hai lần đọc. */
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        const payload = parseData(block);
        if (payload) {
          for (const event of traceEventToSse(payload, resolveOpenToolId)) {
            if (event.type === "tool.started") {
              openTools.set(event.tool_name, event.tool_call_id);
            } else if (event.type === "tool.completed" || event.type === "tool.failed") {
              // Đóng rồi thì gỡ khỏi sổ, để lần gọi sau không khớp nhầm vào nó.
              for (const [name, id] of openTools) {
                if (id === event.tool_call_id) openTools.delete(name);
              }
            }
            onEvent(event);
          }
          if (isTerminalTrace(payload)) {
            onTerminal(payload);
            return;
          }
        }
        sep = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}
