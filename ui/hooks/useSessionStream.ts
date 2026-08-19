"use client";
/* useSessionStream — P04 §8 + §9
   Owns the run lifecycle for the control page: opens the event stream, folds
   every event into message + realtime state, and always cleans up.

   Có hai nguồn sự kiện, và chỉ hai:
     - mock  — `mockSseStream`, kịch bản dựng sẵn cho lúc chưa có backend;
     - thật  — `streamMvpChat`, đọc `POST /chat` của Cloud Agent mvp_vla.

   Chúng đổ vào CÙNG một `handleEvent` bên dưới. Bộ rút gọn đó không biết gì về
   giao thức: mọi khác biệt giữa hai nguồn đã được `lib/api/mvp-chat.ts` nuốt
   hết. Đây là lý do đổi backend mà không component chat nào phải sửa. */

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { mockSseStream, type SseEvent, type MockStreamHandle } from "@/lib/mock/sse";
import { USE_MOCK, CHAT_LIVE } from "@/lib/api/config";
import { streamMvpChat } from "@/lib/api/mvp-chat";
import { toErrorObject } from "@/lib/errors";
import {
  useRealtimeStore,
  toast,
  type Message,
  type ToolCall,
  type Episode,
  type AgentStatusLabel,
} from "@/stores";
import { errorText } from "@/lib/errors";

/** The closed set of user-facing agent statuses — MASTER §13.2.
    Anything the backend sends outside this set collapses to "Đang xử lý";
    we never infer a status from token content. */
const ALLOWED_STATUSES: readonly string[] = [
  "Đang hiểu yêu cầu",
  "Đang quan sát",
  "Đang lập kế hoạch",
  "Đang thực thi",
  "Đang kiểm tra kết quả",
];

function normalizeStatus(raw: string): AgentStatusLabel {
  return (ALLOWED_STATUSES.includes(raw) ? raw : "Đang xử lý") as AgentStatusLabel;
}

interface UseSessionStreamArgs {
  sessionId: string;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

export interface SessionStreamApi {
  /** Begin a run for the text the user just sent. Resolves when the run finishes. */
  startRun: (inputText: string) => Promise<void>;
  /** Tear the stream down (used by the stop button and on unmount). */
  closeStream: () => void;
}

export function useSessionStream({ sessionId, setMessages }: UseSessionStreamArgs): SessionStreamApi {
  const handleRef = useRef<MockStreamHandle | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- helpers that mutate the message list -------------------------- */

  /** Bong bóng mà MỌI thứ của lượt chạy hiện tại gắn vào: tool call, và cả
      chặng agent lúc chốt. Trả về id, tạo bong bóng rỗng nếu lượt này chưa
      sinh ra cái nào.

      Trước đây hai chỗ đều tự quét ngược tìm "assistant cuối cùng" tại thời
      điểm gọi. Kịch bản thật phát narration → tool → narration, nên tool rơi
      vào bong bóng thứ nhất còn chặng rơi vào bong bóng thứ hai — trace bị xé
      làm đôi. Neo theo id giải quyết luôn cả lỗi thứ hai: nếu tool của lượt 2
      tới trước tin nhắn đầu của lượt 2, quét ngược sẽ gắn nhầm vào bong bóng
      của lượt 1, còn anchor `null` nghĩa là "lượt này chưa có gì" nên nó tạo
      bong bóng mới. */
  const ensureRunAnchor = useCallback(
    /* Từ khi `run.started` mở sẵn bong bóng anchor, hàm này chỉ còn là LƯỚI
       HỨNG: tool nổ mà chưa từng có `run.started` (stream nối lại giữa chừng,
       backend gửi thiếu) thì vẫn phải có chỗ để gắn. */
    (fallbackId: string): string => {
      const store = useRealtimeStore.getState();
      const existing = store.runAnchorMessageId;
      if (existing !== null) return existing;
      store.setRunAnchorMessageId(fallbackId);
      return fallbackId;
    },
    [],
  );

  /** Append or update a tool call on the run's anchor message so the card sits
      inline in the conversation (MASTER §13.1) — never in its own bubble,
      never collected at the end. */
  const upsertToolCall = useCallback(
    (toolCallId: string, update: (existing: ToolCall | undefined) => ToolCall) => {
      const anchorId = ensureRunAnchor(`msg-agent-${toolCallId}`);
      /* Tính ngoài updater: React có thể gọi updater hai lần (StrictMode), mà
         `new Date()` trong đó thì mỗi lần ra một giá trị khác. */
      const createdAt = new Date().toISOString();
      setMessages((prev) => {
        const next = [...prev];
        let idx = next.findIndex((m) => m.id === anchorId);
        // Anchor chưa thành hình (tool nổ trước khi có chữ nào) — mở bong bóng.
        if (idx === -1) {
          next.push({
            id: anchorId,
            session_id: sessionId,
            role: "assistant",
            content: "",
            created_at: createdAt,
            tool_calls: [],
          });
          idx = next.length - 1;
        }
        const target = next[idx];
        const calls = [...(target.tool_calls ?? [])];
        const pos = calls.findIndex((c) => c.id === toolCallId);
        const updated = update(pos >= 0 ? calls[pos] : undefined);
        if (pos >= 0) calls[pos] = updated;
        else calls.push(updated);
        next[idx] = { ...target, tool_calls: calls };
        return next;
      });
    },
    [sessionId, setMessages, ensureRunAnchor],
  );

  /** Update the episode attached to a tool call. */
  const upsertEpisode = useCallback(
    (episodeId: string, patch: Partial<Episode>, toolCallId?: string) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.tool_calls) return msg;
          let touched = false;
          const calls = msg.tool_calls.map((call) => {
            const isTarget = toolCallId ? call.id === toolCallId : (call.episodes ?? []).some((e) => e.id === episodeId);
            if (!isTarget) return call;
            touched = true;
            const episodes = [...(call.episodes ?? [])];
            const pos = episodes.findIndex((e) => e.id === episodeId);
            if (pos >= 0) episodes[pos] = { ...episodes[pos], ...patch };
            else
              episodes.push({
                id: episodeId,
                steps: 0,
                max_steps: 400,
                duration_s: 0,
                ...patch,
              });
            return { ...call, episodes };
          });
          return touched ? { ...msg, tool_calls: calls } : msg;
        }),
      );
    },
    [setMessages],
  );

  /** Chốt chặng của lượt vừa xong: gắn vào ĐÚNG bong bóng anchor — cùng chỗ
      với tool call của lượt đó — rồi dọn store cho lượt sau. */
  const sealAgentSteps = useCallback(() => {
    const store = useRealtimeStore.getState();
    store.closeAgentSteps();
    const steps = useRealtimeStore.getState().agentSteps;
    const anchorId = store.runAnchorMessageId;
    if (steps.length > 0 && anchorId !== null) {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === anchorId);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], agent_steps: steps };
        return next;
      });
    }
    store.resetAgentSteps();
  }, [setMessages]);

  /* ---- the reducer: one case per row of the P04 §8 table -------------- */

  const handleEvent = useCallback(
    (event: SseEvent) => {
      const store = useRealtimeStore.getState();

      switch (event.type) {
        case "run.started": {
          store.setRunId(event.run_id);
          store.lockComposer();
          store.setBanner(null);
          // Dọn chặng của lượt trước, nếu không nó cộng dồn qua mọi lượt chat
          // và ra "Đã xong 25 bước" với danh sách lặp đi lặp lại.
          store.resetAgentSteps();
          // Suy nghĩ dở của lượt trước (luồng đứt giữa chừng) không được rơi
          // sang lượt này — nó sẽ hiện dưới một câu hỏi mà nó không hề nói về.
          store.finalizeThought();

          /* Mở BONG BÓNG RỖNG ngay, trước cả token đầu tiên.

             Trước đây anchor chỉ thành hình ở `message.completed`, nên suốt
             mấy giây đầu trace phải nổi tạm ở đáy hội thoại rồi nhảy lên khi
             câu trả lời xuất hiện. Ở nhịp chậm, cú nhảy đó nhìn rõ và khó chịu.

             Đổi lại: chữ đang stream phải chảy vào ĐÚNG bong bóng này chứ
             không dựng bong bóng riêng, nếu không mỗi lượt ra hai bong bóng —
             một chứa trace, một chứa chữ. Xem `message.completed` bên dưới và
             `MessageList`. */
          const anchorId = `msg-run-${event.run_id}`;
          store.setRunAnchorMessageId(anchorId);
          const createdAt = new Date().toISOString();
          setMessages((prev) =>
            prev.some((m) => m.id === anchorId)
              ? prev
              : [
                  ...prev,
                  {
                    id: anchorId,
                    session_id: sessionId,
                    role: "assistant" as const,
                    content: "",
                    created_at: createdAt,
                  },
                ],
          );
          break;
        }

        case "agent.status": {
          const label = normalizeStatus(event.status);
          store.setAgentStatus(label);
          // Ghi lại thành một bước để người dùng thấy được cả chặng đã đi, chứ
          // không chỉ mỗi bước hiện tại rồi nó biến mất.
          store.pushAgentStep(label);
          break;
        }

        case "token.delta":
          store.appendStreamingContent(event.message_id, event.delta);
          break;

        case "thinking.delta":
          store.appendStreamingThought(event.message_id, event.delta);
          break;

        case "thinking.completed": {
          /* Chốt suy nghĩ vào ĐÚNG bong bóng anchor của lượt — cùng chỗ với
             tool call và chặng — để cuộn lại vẫn mở ra xem được.

             Nhiều đoạn suy nghĩ trong một lượt thì NỐI vào nhau, ngăn bằng một
             dòng trống. Ghi đè thì chỉ còn đoạn cuối, và đoạn giải thích vì sao
             agent chọn cách tiếp cận này — thường nằm ở đoạn ĐẦU — biến mất. */
          const thought = useRealtimeStore.getState().streamingThought;
          const anchorId = useRealtimeStore.getState().runAnchorMessageId;
          if (thought && thought.content.trim() && anchorId !== null) {
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === anchorId);
              if (idx === -1) return prev;
              const next = [...prev];
              const before = next[idx].thinking;
              next[idx] = {
                ...next[idx],
                thinking: before ? `${before}\n\n${thought.content.trim()}` : thought.content.trim(),
                thinking_ms: (next[idx].thinking_ms ?? 0) + event.duration_ms,
              };
              return next;
            });
          }
          store.finalizeThought();
          break;
        }

        case "message.completed": {
          const streaming = useRealtimeStore.getState().streamingMessage;
          if (streaming) {
            const anchorId = useRealtimeStore.getState().runAnchorMessageId;
            const createdAt = new Date().toISOString();
            /* `run_metadata` là của develop — nó nuôi chân bong bóng "Xem
               trace". Đọc MỘT lần ở đây rồi gắn cho cả hai nhánh bên dưới:
               chỉ gắn ở nhánh tạo bong bóng mới thì câu trả lời đầu của lượt
               (đi vào anchor) mất link, còn câu narration thứ hai lại có —
               cùng một lượt chạy mà lúc có lúc không. */
            const runMeta =
              "run_metadata" in event && event.run_metadata ? event.run_metadata : undefined;
            setMessages((prev) => {
              const idx = anchorId === null ? -1 : prev.findIndex((m) => m.id === anchorId);
              /* Anchor còn RỖNG nghĩa là đây là câu trả lời đầu của lượt — đổ
                 chữ vào chính nó thay vì dựng bong bóng mới. Kịch bản thật còn
                 một narration thứ hai ("Đã hoàn thành yêu cầu…"); lúc đó anchor
                 đã có chữ nên câu sau thành bong bóng riêng, đúng như cũ. */
              if (idx !== -1 && prev[idx].content === "") {
                const next = [...prev];
                next[idx] = {
                  ...next[idx],
                  content: streaming.content,
                  created_at: createdAt,
                  ...(runMeta ? { run: runMeta } : {}),
                };
                return next;
              }
              const finalized: Message = {
                id: streaming.id,
                session_id: sessionId,
                role: "assistant",
                content: streaming.content,
                created_at: createdAt,
              };
              if (runMeta) finalized.run = runMeta;
              return [...prev, finalized];
            });
          }
          store.finalizeMessage();
          break;
        }

        case "tool.started":
          upsertToolCall(event.tool_call_id, (existing) => ({
            ...(existing ?? {
              id: event.tool_call_id,
              tool_name: event.tool_name,
              arguments: event.arguments,
            }),
            id: event.tool_call_id,
            tool_name: event.tool_name,
            arguments: event.arguments,
            // Giữ mốc cũ khi sự kiện đến lặp (reconnect): thứ tự không được nhảy.
            started_at: existing?.started_at ?? Date.now(),
            status: "RUNNING",
          }));
          break;

        case "tool.progress":
          store.updateToolCard(event.tool_call_id, { progress: event.progress });
          break;

        case "tool.completed":
          upsertToolCall(event.tool_call_id, (existing) => ({
            id: event.tool_call_id,
            tool_name: existing?.tool_name ?? "",
            arguments: existing?.arguments ?? {},
            episodes: existing?.episodes,
            // BẮT BUỘC mang theo: hai case này dựng lại object từ đầu, quên thì
            // hàng mất vị trí trong trace ngay khi tool xong.
            started_at: existing?.started_at,
            status: "SUCCEEDED",
            result: event.result,
            duration_ms: event.duration_ms,
          }));
          break;

        case "tool.failed":
          upsertToolCall(event.tool_call_id, (existing) => ({
            id: event.tool_call_id,
            tool_name: existing?.tool_name ?? "",
            arguments: existing?.arguments ?? {},
            episodes: existing?.episodes,
            started_at: existing?.started_at,
            status: "FAILED",
            error: event.error,
            duration_ms: event.duration_ms,
          }));
          break;

        case "episode.started":
          upsertEpisode(
            event.episode_id,
            { steps: 0, max_steps: event.max_steps, duration_s: 0, instruction: event.instruction },
            event.tool_call_id,
          );
          store.setEpisodeProgress({
            id: event.episode_id,
            step: 0,
            max_steps: event.max_steps,
            instruction: event.instruction,
            duration_s: 0,
          });
          break;

        case "episode.progress":
          upsertEpisode(event.episode_id, {
            steps: event.step,
            max_steps: event.max_steps,
            duration_s: event.elapsed_s,
          });
          store.setEpisodeProgress({
            id: event.episode_id,
            step: event.step,
            max_steps: event.max_steps,
            instruction: useRealtimeStore.getState().episodeProgress?.instruction,
            duration_s: event.elapsed_s,
          });
          break;

        case "episode.completed":
          upsertEpisode(event.episode_id, {
            steps: event.steps,
            duration_s: event.duration_s,
            outcome: event.outcome,
            stop_reason: event.stop_reason,
          });
          store.setEpisodeProgress(null);
          break;

        case "episode.stopped":
          store.setBanner({ tone: "info", message: "Đã dừng theo yêu cầu." });
          if (bannerTimer.current) clearTimeout(bannerTimer.current);
          bannerTimer.current = setTimeout(() => useRealtimeStore.getState().setBanner(null), 3000);
          break;

        case "robot.state.updated":
          store.updateRobotState({
            robot_status: event.robot_status,
            connection_status: event.connection_status,
            joints: event.joints,
          });
          break;

        case "robot.disconnected":
          // Not a transient failure — do not retry, but keep Stop reachable.
          store.setRobotDisconnected(true);
          store.lockComposer();
          store.setBanner({ tone: "error", message: "Robot mất kết nối. Kiểm tra thiết bị Edge trước khi ra lệnh tiếp." });
          break;

        case "robot.reconnected":
          store.setRobotDisconnected(false);
          store.setBanner(null);
          break;

        case "artifact.created":
          store.addImage({
            id: event.artifact.id,
            url: event.artifact.url,
            camera: event.artifact.camera,
            captured_at: event.artifact.captured_at,
          });
          break;

        case "run.completed":
          store.unlockComposer();
          store.setAgentStatus(null);
          sealAgentSteps();
          store.setRunId(null);
          break;

        case "run.failed":
          store.unlockComposer();
          store.setAgentStatus(null);
          sealAgentSteps();
          store.setRunId(null);
          store.setBanner({
            tone: "error",
            message: errorText(event.error),
            code: event.error.code,
          });
          break;

        case "run.cancelled":
          store.unlockComposer();
          store.setAgentStatus(null);
          sealAgentSteps();
          store.setRunId(null);
          store.setBanner({ tone: "info", message: "Đã huỷ." });
          break;

        case "error":
          // Non-blocking: toast only, composer stays usable.
          toast.error(errorText(event.error));
          break;

        case "ping":
          break;

        default:
          // Unknown event: ignore safely, never crash the page (P04 §8).
          console.debug("[sse] unhandled event", event);
      }
    },
    [sessionId, setMessages, upsertToolCall, upsertEpisode, sealAgentSteps],
  );

  const closeStream = useCallback(() => {
    handleRef.current?.close();
    handleRef.current = null;
    useRealtimeStore.getState().setCloseStream(null);
  }, []);

  const startRun = useCallback(
    async (inputText: string) => {
      closeStream();
      const runId = `run-${Date.now().toString(36)}`;
      const store = useRealtimeStore.getState();
      store.lockComposer();
      store.setAgentStatus("Đang hiểu yêu cầu");
      store.setRunId(runId);
      store.setBanner(null);

      if (USE_MOCK && !CHAT_LIVE) {
        handleRef.current = mockSseStream({ runId, inputText, onEvent: handleEvent });
        store.setCloseStream(() => handleRef.current?.close());
        return;
      }

      /* Cloud Agent thật của mvp_vla.
       *
       * Một request duy nhất: `POST /chat` mở luồng SSE và giữ nó tới khi agent
       * xong. Không có bước "mở lượt chạy rồi đăng ký luồng" như bản gốc, vì
       * backend này chỉ có một endpoint — nên cũng không có `run_id` do server
       * cấp, ta tự đặt và phát `run.started` ngay trước khi gọi.
       *
       * Phát `run.started` TRƯỚC `fetch`, không phải sau: nó mở bong bóng anchor
       * và khoá composer. Chờ tới lúc có phản hồi đầu tiên thì trong vài giây
       * đầu giao diện đứng im, không dấu hiệu gì cho thấy lệnh đã được nhận. */
      let cancelled = false;
      /* Trần cứng cho một lượt: model free trên OpenRouter thường mất 30–90s mỗi
         vòng tool, và `take_action` + `check_status` có thể lặp nhiều vòng
         (`MAX_POLL`, `MAX_RETRY` trong `edge_vla/config.py`). Không có trần thì
         một lượt hỏng sẽ khoá composer vĩnh viễn. */
      const controller = new AbortController();
      const hardTimeoutMs = 300_000;
      const hardTimer = window.setTimeout(() => controller.abort(), hardTimeoutMs);

      const handle = {
        close: () => {
          cancelled = true;
          controller.abort();
        },
      };
      handleRef.current = handle;
      store.setCloseStream(() => handle.close());

      handleEvent({ type: "run.started", run_id: runId, input_text: inputText });

      try {
        await streamMvpChat({
          message: inputText,
          /* `thread_id` = id phiên của giao diện. Đây là khoá mà `MemorySaver`
             của LangGraph dùng để nhớ hội thoại (`server/graph.py`), nên gửi id
             phiên vào chính là thứ làm cho câu thứ hai hiểu được ngữ cảnh câu
             thứ nhất. Gửi một giá trị mới mỗi lượt thì agent quên sạch. */
          threadId: sessionId,
          signal: controller.signal,
          onEvent: handleEvent,
        });
        if (cancelled) return;
        handleEvent({ type: "run.completed", run_id: runId });
      } catch (err) {
        if (cancelled) return;
        const isAbort =
          err instanceof DOMException
            ? err.name === "AbortError"
            : err instanceof Error && err.name === "AbortError";
        const e = isAbort
          ? {
              code: "AGENT_003",
              message:
                "Agent chạy quá lâu. Thử câu ngắn hơn, hoặc đổi sang model nhanh hơn trong .env.",
            }
          : toErrorObject(err);

        /* Nói lỗi ra thành một bong bóng của agent, chứ không chỉ một banner:
           banner đóng được và biến mất, còn hội thoại thì giữ lại dấu vết rằng
           lượt này đã hỏng vì cái gì. */
        const messageId = `msg-agent-${runId}`;
        handleEvent({ type: "token.delta", message_id: messageId, delta: e.message });
        handleEvent({ type: "message.completed", message_id: messageId });

        handleEvent({
          type: "run.failed",
          run_id: runId,
          error: { code: e.code, message: e.message },
        });
        throw err;
      } finally {
        window.clearTimeout(hardTimer);
        if (handleRef.current === handle) handleRef.current = null;
        // Always unlock — never leave the composer stuck on "Agent đang xử lý".
        const rt = useRealtimeStore.getState();
        rt.unlockComposer();
        rt.setAgentStatus(null);
        rt.setRunId(null);
      }
    },
    [closeStream, handleEvent, sessionId],
  );

  // Every connection-opening effect cleans up — MASTER §21.
  useEffect(() => {
    return () => {
      handleRef.current?.close();
      handleRef.current = null;
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      useRealtimeStore.getState().reset();
    };
  }, [sessionId]);

  return { startRun, closeStream };
}
