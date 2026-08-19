/* Adapter luồng chat của mvp_vla → từ vựng sự kiện của giao diện.
 *
 * Backend mvp_vla (`server/main.py`) phát MỘT luồng SSE duy nhất trên
 * `POST /chat`:
 *
 *     agent_text        {text}              lời nói với người dùng
 *     agent_reasoning   {text}              suy nghĩ nội bộ, đã được
 *                                           `server/harmony.py` tách ra khỏi
 *                                           lời nói
 *     agent_message_end {}                  model nói xong một tin nhắn
 *     tool_call         {id, name, args}    agent quyết định gọi một tool MCP
 *     tool_result       {id, name, result}  tool đó trả về
 *     done              {}                  lượt chạy kết thúc
 *
 * Giao diện thì nói một thứ tiếng khác — `SseEvent` trong `lib/mock/sse.ts` —
 * giàu hơn nhiều: có vòng đời run, có id cho từng tool call, có episode. File
 * này là chỗ DUY NHẤT biết cả hai thứ tiếng. Nhờ vậy `useSessionStream` và toàn
 * bộ component chat không phải biết gì về mvp_vla.
 *
 * Ba chỗ khó, đều là hệ quả của việc backend nói ít hơn giao diện cần:
 *
 *   1. `tool_call_id`. Backend GIỜ đã gửi `id` thật của LangChain, và khi có
 *      thì dùng thẳng. Hàng đợi FIFO theo tên vẫn giữ làm đường lui — cho
 *      backend cũ chưa gửi id, và cho trường hợp `tool_result` tới mà chưa từng
 *      thấy `tool_call` (luồng nối lại giữa chừng).
 *   2. Không có nhãn trạng thái agent. Suy ra từ TÊN TOOL — một sự thật của
 *      backend, không phải suy diễn từ nội dung model (§13.3).
 *   3. Không có sự kiện episode. Dựng lại từ tham số/kết quả của `take_action`
 *      và `check_status`, vốn đã mang sẵn `k`, `step`, `total`, `status`.
 */

import type { SseEvent } from "@/lib/mock/sse";
/* Đường dẫn TƯƠNG ĐỐI, không phải `@/lib/...`: file này được `npm run
   verify:mvp-chat` nạp thẳng bằng Node (`--experimental-strip-types`), và Node
   không biết alias `@/` của tsconfig, và bắt buộc phải có đuôi thật. Import
   kiểu thì bị xoá lúc biên dịch nên không sao; import GIÁ TRỊ thì làm script
   kiểm chứng chết ngay khi khởi động (`allowImportingTsExtensions` trong
   `tsconfig.json` có mặt đúng vì lý do này). */
import { stripControlTokens } from "../agent-text.ts";
import type { AgentStatusLabel, EpisodeOutcome } from "@/stores";

/** Trạng thái kết thúc mà edge trả về khi thao tác KHÔNG thành công.
    Lấy từ `describeStatus` của giao diện cũ (`ui/index.html`) — cùng một danh
    sách, nên tool card đỏ ở đúng những lúc bản cũ đã đỏ. */
const FAILURE_STATUSES = new Set(["FAILED_MAX_RETRY", "SAFETY_STOP", "TIMEOUT", "ABORTED"]);

/** Câu giải thích cho từng trạng thái hỏng, để `errorText` có cái mà hiện. */
const STATUS_MESSAGE: Record<string, string> = {
  FAILED_MAX_RETRY: "Thử nhiều lần vẫn chưa được, tay đã lùi về vị trí an toàn.",
  SAFETY_STOP: "Dừng khẩn cấp vì lý do an toàn.",
  TIMEOUT: "Hết thời gian chờ phản hồi từ robot.",
  ABORTED: "Thao tác đã bị huỷ.",
};

/** Kết cục episode, dịch từ `status` của edge sang từ vựng UI. */
const OUTCOME_BY_STATUS: Record<string, EpisodeOutcome> = {
  FAILED_MAX_RETRY: "MAX_STEPS",
  SAFETY_STOP: "SAFETY_ABORT",
  TIMEOUT: "TIMEOUT",
  ABORTED: "STOPPED",
};

/** Nhãn trạng thái suy ra từ tool agent vừa gọi.
    Mọi giá trị ở đây PHẢI nằm trong `ALLOWED_STATUSES` của `useSessionStream`,
    nếu không nó bị gom hết về "Đang xử lý" và mất ý nghĩa. */
const STATUS_BY_TOOL: Record<string, AgentStatusLabel> = {
  get_robot_state: "Đang hiểu yêu cầu",
  capture: "Đang quan sát",
  take_action: "Đang thực thi",
  check_status: "Đang kiểm tra kết quả",
  check_success: "Đang kiểm tra kết quả",
  go_home: "Đang thực thi",
  abort: "Đang thực thi",
  reset_episode: "Đang lập kế hoạch",
};

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ parse */

/** Một khối SSE đã tách thành tên sự kiện + payload đã parse JSON. */
export interface RawEvent {
  event: string;
  data: Json;
}

/** Tách một khối SSE (`event:` + một hay nhiều dòng `data:`) thành `RawEvent`.
    Tách riêng khỏi phần dịch để test được mà không cần dựng cả một luồng. */
export function parseSseBlock(block: string): RawEvent | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: asRecord(JSON.parse(data)) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- translator */

/** Máy dịch có trạng thái: mỗi lượt chạy dựng một cái mới.
 *
 * Giữ trạng thái vì việc dịch KHÔNG phải ánh xạ một-một: một `tool_result` cần
 * biết `tool_call` nào đang chờ, một `agent_text` cần biết bong bóng hiện tại đã
 * mở chưa, và `check_status` cần biết episode nào đang chạy. */
export class MvpChatTranslator {
  private readonly runId: string;
  private readonly emit: (event: SseEvent) => void;

  /** Hàng đợi `tool_call_id` đang chờ kết quả, theo tên tool (FIFO). */
  private readonly pending = new Map<string, string[]>();
  /** Tham số của tool call, giữ lại để `tool_result` đọc được (vd `k`). */
  private readonly argsById = new Map<string, Json>();
  /** Mốc bắt đầu, để tính `duration_ms` thật thay vì bịa số 0. */
  private readonly startedAtById = new Map<string, number>();

  private seq = 0;
  /** Id bong bóng text đang mở, `null` khi chưa có text nào của chặng này. */
  private openMessageId: string | null = null;
  /** Id khối suy nghĩ đang mở. Tách khỏi `openMessageId` vì hai dòng này đóng
      mở KHÔNG cùng nhịp: model thường nghĩ xong mới nói, và một tin nhắn có thể
      có suy nghĩ mà không có lời nói (khi nó chỉ gọi tool). */
  private openThoughtId: string | null = null;
  /** Mốc mẩu suy nghĩ đầu tiên của khối đang mở — để nói được "đã suy nghĩ 4s"
      thay vì một nhãn trơ không cho biết agent dừng lại bao lâu. */
  private thoughtStartedAt = 0;
  /** Episode đang chạy — `take_action` mở ra, `check_status` bồi vào. */
  private episode: { id: string; maxSteps: number; startedAt: number } | null = null;

  constructor(runId: string, emit: (event: SseEvent) => void) {
    this.runId = runId;
    this.emit = emit;
  }

  /** Đưa một sự kiện thô của mvp_vla vào; các `SseEvent` tương ứng được phát ra. */
  handle(raw: RawEvent): void {
    switch (raw.event) {
      case "agent_text":
        this.onText(raw.data);
        break;
      case "agent_reasoning":
        this.onReasoning(raw.data);
        break;
      case "agent_message_end":
        /* Model đã nói xong MỘT tin nhắn. Đóng cả hai dòng: lượt sau bắt đầu
           bằng bong bóng mới, thay vì bồi tiếp vào bong bóng của vòng trước. */
        this.closeThought();
        this.closeMessage();
        break;
      case "tool_call":
        this.onToolCall(raw.data);
        break;
      case "tool_result":
        this.onToolResult(raw.data);
        break;
      case "done":
        this.finish();
        break;
      default:
        break;
    }
  }

  /** Chốt mọi thứ còn dở. Gọi cả khi luồng kết thúc bình thường lẫn khi hỏng,
      nếu không bong bóng text cuối sẽ treo mãi ở trạng thái "đang gõ". */
  finish(): void {
    this.closeThought();
    this.closeMessage();
    this.closeEpisode("STOPPED");
  }

  /** Tool nào chưa có kết quả thì đánh hỏng hết — luồng đã đứt, chúng sẽ không
      bao giờ nhận được `tool_result` và sẽ quay mãi trong trace. */
  failPending(error: { code: string; message: string }): void {
    for (const ids of this.pending.values()) {
      for (const id of ids) {
        this.emit({
          type: "tool.failed",
          tool_call_id: id,
          error,
          duration_ms: this.elapsed(id),
        });
      }
    }
    this.pending.clear();
  }

  /* ---- text ---- */

  private onText(data: Json): void {
    /* `stripControlTokens` là HÀNG RÀO THỨ HAI. Bộ tách thật nằm ở backend
       (`server/harmony.py`), nơi nó nhìn được cả luồng và ghép lại được dấu
       hiệu bị cắt đôi. Nhưng chỉ cần một model lạ phát một biến thể chưa gặp là
       `<|channel|>` lại nằm giữa bong bóng chat — đúng lỗi vừa sửa. Lọc thêm ở
       đây thì cái giá phải trả là một regex, còn cái tránh được là người dùng
       nhìn thấy token nội bộ. */
    const delta = stripControlTokens(typeof data.text === "string" ? data.text : "");
    if (!delta) return;
    if (this.openMessageId === null) {
      this.openMessageId = `msg-${this.runId}-${this.seq++}`;
    }
    this.emit({ type: "token.delta", message_id: this.openMessageId, delta });
  }

  /* ---- suy nghĩ ---- */

  private onReasoning(data: Json): void {
    const delta = stripControlTokens(typeof data.text === "string" ? data.text : "");
    if (!delta) return;
    if (this.openThoughtId === null) {
      this.openThoughtId = `th-${this.runId}-${this.seq++}`;
      this.thoughtStartedAt = Date.now();
    }
    this.emit({ type: "thinking.delta", message_id: this.openThoughtId, delta });
  }

  /** Chốt khối suy nghĩ hiện tại.

      Gọi ngay khi tool đầu tiên nổ, chứ không đợi hết lượt: suy nghĩ dẫn tới
      MỘT hành động, và khi hành động đó đã bắt đầu thì phần nghĩ ấy đã xong.
      Để mở thì suy nghĩ của cả lượt dồn vào một khối khổng lồ, đọc không ra
      được đoạn nào ứng với việc nào. */
  private closeThought(): void {
    if (this.openThoughtId === null) return;
    this.emit({
      type: "thinking.completed",
      message_id: this.openThoughtId,
      duration_ms: this.thoughtStartedAt ? Date.now() - this.thoughtStartedAt : 0,
    });
    this.openThoughtId = null;
    this.thoughtStartedAt = 0;
  }

  /** Chốt bong bóng text hiện tại, nếu có.
   *
   * Giao diện cũ đặt `agentDiv = null` mỗi khi gặp một sự kiện tool, nên chữ
   * trước và sau một tool nằm ở hai bong bóng khác nhau. Giữ đúng hành vi đó:
   * bỏ bước này thì lời dẫn trước khi gọi tool và lời tổng kết sau khi tool xong
   * dính làm một khối, đọc như thể agent nói liền mạch trong khi thực tế nó đã
   * dừng lại làm một việc gì đó ở giữa. */
  private closeMessage(): void {
    if (this.openMessageId === null) return;
    this.emit({ type: "message.completed", message_id: this.openMessageId });
    this.openMessageId = null;
  }

  /* ---- tool ---- */

  private onToolCall(data: Json): void {
    const name = typeof data.name === "string" ? data.name : "";
    if (!name) return;
    const args = asRecord(data.args);

    this.closeThought();
    this.closeMessage();

    const status = STATUS_BY_TOOL[name];
    if (status) this.emit({ type: "agent.status", status });

    /* Id THẬT của backend khi có. Nó là thứ duy nhất ghép đúng cặp khi model
       gọi song song hai lần cùng một tool — hàng đợi FIFO theo tên thì hai kết
       quả về ngược thứ tự là gắn nhầm nhau. */
    const backendId = typeof data.id === "string" && data.id ? data.id : "";
    const id = backendId || `tc-${this.runId}-${this.seq++}`;
    const queue = this.pending.get(name);
    if (queue) queue.push(id);
    else this.pending.set(name, [id]);
    this.argsById.set(id, args);
    this.startedAtById.set(id, Date.now());

    this.emit({ type: "tool.started", tool_call_id: id, tool_name: name, arguments: args });
  }

  private onToolResult(data: Json): void {
    const name = typeof data.name === "string" ? data.name : "";
    if (!name) return;
    const result = asRecord(data.result);

    this.closeThought();
    this.closeMessage();

    /* Ghép cặp theo BA nấc, từ chắc chắn xuống phỏng đoán:
         1. id thật của backend, nếu lời gọi tương ứng đã đi qua đây;
         2. hàng đợi FIFO theo tên — backend cũ không gửi id, mà `tools_node`
            phía server chạy tuần tự nên thứ tự vẫn khớp;
         3. dựng một call rỗng — kết quả tới mà chưa từng thấy lời gọi (luồng
            nối lại giữa chừng). Thà có một dòng thiếu tham số còn hơn im lặng
            đánh rơi một việc robot đã thực sự làm. */
    const backendId = typeof data.id === "string" && data.id ? data.id : "";
    const queue = this.pending.get(name);
    let id = backendId && this.startedAtById.has(backendId) ? backendId : undefined;
    if (id) {
      // Rút khỏi hàng đợi luôn, nếu không nó chặn đúng chỗ của kết quả sau.
      const pos = queue?.indexOf(id) ?? -1;
      if (pos >= 0) queue?.splice(pos, 1);
    } else {
      id = queue?.shift();
    }
    if (!id) {
      id = `tc-${this.runId}-${this.seq++}`;
      this.startedAtById.set(id, Date.now());
      this.emit({ type: "tool.started", tool_call_id: id, tool_name: name, arguments: {} });
    }

    this.trackEpisode(name, id, result);

    const status = typeof result.status === "string" ? result.status : "";
    const errorText = typeof result.error === "string" ? result.error : "";
    const duration_ms = this.elapsed(id);

    if (errorText || FAILURE_STATUSES.has(status)) {
      const reason = typeof result.reason === "string" ? result.reason : "";
      const message =
        errorText || `${STATUS_MESSAGE[status] ?? "Thao tác thất bại."}${reason ? ` ${reason}` : ""}`;
      this.emit({
        type: "tool.failed",
        tool_call_id: id,
        error: { code: status || "EDGE_ERROR", message },
        duration_ms,
      });
      return;
    }

    this.emit({ type: "tool.completed", tool_call_id: id, status: "SUCCEEDED", result, duration_ms });
  }

  private elapsed(id: string): number {
    const startedAt = this.startedAtById.get(id);
    return startedAt ? Date.now() - startedAt : 0;
  }

  /* ---- episode ---- */

  /** Dựng lại vòng đời episode từ hai tool mà backend vốn đã kể đủ.
   *
   * `take_action` trả `task_id` và nhận `k` (số bước tối đa) — đủ để mở một
   * episode. `check_status` là vòng lặp thăm dò, mỗi lần trả `step`/`total`/
   * `status` — đủ để bồi tiến độ và chốt kết cục.
   *
   * Nhờ vậy thanh `EpisodeProgress` chạy thật, dù backend chưa từng phát một sự
   * kiện episode nào. */
  private trackEpisode(name: string, toolCallId: string, result: Json): void {
    if (name === "take_action") {
      const taskId = typeof result.task_id === "string" ? result.task_id : "";
      if (!taskId) return;
      const args = this.argsById.get(toolCallId) ?? {};
      const maxSteps = asNumber(args.k) ?? 200;
      const instruction = typeof args.subgoal === "string" ? args.subgoal : undefined;
      this.episode = { id: taskId, maxSteps, startedAt: Date.now() };
      this.emit({
        type: "episode.started",
        episode_id: taskId,
        tool_call_id: toolCallId,
        instruction,
        max_steps: maxSteps,
      });
      return;
    }

    if (name !== "check_status" || !this.episode) return;

    const status = typeof result.status === "string" ? result.status : "";
    const step = asNumber(result.step) ?? 0;
    const total = asNumber(result.total) ?? this.episode.maxSteps;
    const elapsed_s = Math.round((Date.now() - this.episode.startedAt) / 1000);

    if (status === "RUNNING") {
      this.emit({
        type: "episode.progress",
        episode_id: this.episode.id,
        step,
        max_steps: total,
        elapsed_s,
      });
      return;
    }

    /* `DONE` nhưng `success` sai KHÔNG phải thành công: agent sẽ xem ảnh rồi thử
       lại. Gọi nó là SUCCESS thì thanh tiến độ báo xanh trong khi việc chưa xong. */
    const outcome: EpisodeOutcome =
      status === "DONE"
        ? result.success === true
          ? "SUCCESS"
          : "MAX_STEPS"
        : (OUTCOME_BY_STATUS[status] ?? "STOPPED");
    this.closeEpisode(outcome, step, status);
  }

  private closeEpisode(outcome: EpisodeOutcome, steps?: number, stopReason?: string): void {
    if (!this.episode) return;
    this.emit({
      type: "episode.completed",
      episode_id: this.episode.id,
      outcome,
      steps: steps ?? 0,
      duration_s: Math.round((Date.now() - this.episode.startedAt) / 1000),
      stop_reason: stopReason,
    });
    this.episode = null;
  }
}

/* ------------------------------------------------------------------ stream */

export interface StreamMvpChatArgs {
  message: string;
  /** Khoá hội thoại phía LangGraph (`MemorySaver`) — dùng id phiên của UI. */
  threadId: string;
  signal: AbortSignal;
  onEvent: (event: SseEvent) => void;
}

/** Mở `POST /chat` và bơm sự kiện cho tới khi luồng đóng.
 *
 * Dùng `fetch` + `ReadableStream` chứ không phải `EventSource`: `EventSource`
 * chỉ biết GET, mà endpoint này cần một body JSON.
 *
 * Ném lỗi khi HTTP hỏng hoặc mạng đứt; chỗ gọi chịu trách nhiệm phát
 * `run.failed`. */
export async function streamMvpChat({ message, threadId, signal, onEvent }: StreamMvpChatArgs): Promise<void> {
  const runId = `run-${Date.now().toString(36)}`;
  const translator = new MvpChatTranslator(runId, onEvent);

  let response: Response;
  try {
    response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, thread_id: threadId }),
      signal,
    });
  } catch (err) {
    translator.failPending({ code: "NETWORK", message: "Không kết nối được tới máy chủ agent." });
    translator.finish();
    throw err;
  }

  if (!response.ok || !response.body) {
    translator.finish();
    throw new Error(`Máy chủ agent trả về ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // `\r\n` → `\n` trước khi tách: bộ tách dưới đây chỉ tìm dòng trống kiểu LF.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const raw = parseSseBlock(block);
        if (raw) translator.handle(raw);
      }
    }
  } catch (err) {
    translator.failPending({ code: "STREAM", message: "Luồng sự kiện bị ngắt giữa chừng." });
    translator.finish();
    throw err;
  } finally {
    reader.cancel().catch(() => undefined);
  }

  // Luồng đóng mà chưa từng thấy `done` — vẫn phải chốt cho sạch.
  translator.finish();
}

/** Đưa tay robot về vị trí home (`POST /go_home`), bỏ qua LLM agent. */
export async function postGoHome(signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch("/go_home", { method: "POST", signal });
  if (!response.ok) throw new Error(`Máy chủ agent trả về ${response.status}.`);
  return asRecord(await response.json());
}
