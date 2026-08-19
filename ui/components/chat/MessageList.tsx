"use client";
/* MessageList — P04 §3
   Auto-scrolls to the bottom on new content, except when the user has scrolled
   more than 100px up — then it holds position and offers a jump button.
   Bubbles are memoised by id + content so telemetry updates elsewhere don't
   re-render the whole conversation (MASTER §16). */

import { useRef, useEffect, useState, useCallback, memo } from "react";
import { ArrowDown } from "lucide-react";
import type { Message } from "@/stores";
import { MessageBubble } from "./MessageBubble";
import { ThinkingBlock } from "./ThinkingBlock";
import { useSmoothText } from "@/hooks/useSmoothText";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/common/Skeleton";
import { useRealtimeStore } from "@/stores";

/* So sánh THAM CHIẾU, không liệt kê từng trường.
 *
 * Bản cũ liệt kê `id`/`content`/`send_status`/`tool_calls` — và quên
 * `agent_steps`. Lúc chốt chặng, `sealAgentSteps` ghi `{...msg, agent_steps}`
 * giữ nguyên cả bốn trường đó, nên comparator trả `true`, React bỏ render, và
 * chặng vừa chốt KHÔNG BAO GIỜ hiện ra. Cùng lúc `runId → null` xoá khối live:
 * chạy xong là trace biến mất sạch.
 *
 * Mọi chỗ sửa message đều tạo object mới bằng spread — không nơi nào mutate tại
 * chỗ — nên so sánh tham chiếu vừa đúng vừa chặt hơn, và không mục ruỗng khi
 * `Message` mọc thêm trường. Đó chính là cách lỗi trên sinh ra. */
const MemoBubble = memo(
  MessageBubble,
  (prev, next) =>
    prev.message === next.message &&
    prev.liveSteps === next.liveSteps &&
    prev.streamingContent === next.streamingContent &&
    prev.streamingThought === next.streamingThought &&
    prev.showCameraLink === next.showCameraLink &&
    prev.onRetry === next.onRetry,
);

interface MessageListProps {
  messages: Message[];
  streamingContent?: string | null;
  loading?: boolean;
  onRetry?: (message: Message) => void;
}

/** Bong bóng đang gõ dở, dùng cho câu trả lời THỨ HAI trở đi của một lượt.

    Là component riêng chứ không phải JSX tại chỗ, vì nó cần `useSmoothText` —
    hook thì không gọi được trong một nhánh điều kiện giữa thân hàm. */
function StreamingBubble({ content, thought }: { content: string; thought?: string }) {
  const smooth = useSmoothText(content, true);
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[86%] bg-ink-800 text-paper-50 border border-[var(--line)] rounded-2xl rounded-bl-md px-4 py-3 text-[14px] leading-[1.5]">
        {thought && <ThinkingBlock text={thought} streaming />}
        {smooth}
        <span className="inline-block w-1.5 h-4 align-text-bottom bg-arc-400 rounded-full ml-0.5 animate-pulse-dot" />
      </div>
    </div>
  );
}

export function MessageList({ messages, streamingContent, loading, onRetry }: MessageListProps) {
  const liveSteps = useRealtimeStore((s) => s.agentSteps);
  const streamingThought = useRealtimeStore((s) => s.streamingThought);
  const runId = useRealtimeStore((s) => s.runId);
  const anchorId = useRealtimeStore((s) => s.runAnchorMessageId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Follow new content only while the user is at the bottom (P04 §3).
  useEffect(() => {
    if (pinnedToBottom) scrollToBottom();
  }, [messages, streamingContent, pinnedToBottom, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinnedToBottom(distanceFromBottom <= 100);
  }, []);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 px-5 py-4 space-y-4 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className={i % 2 === 1 ? "ml-auto max-w-[76%]" : "max-w-[86%]"}>
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        ))}
      </div>
    );
  }

  const isEmpty = messages.length === 0 && !streamingContent && !streamingThought;

  /* Chữ đang stream chảy vào bong bóng anchor khi bong bóng đó còn RỖNG — đó là
     câu trả lời đầu của lượt. Câu thứ hai trở đi thì anchor đã có chữ, nên rơi
     về bong bóng streaming rời như cũ. */
  const anchorAwaitingText =
    anchorId !== null && messages.some((m) => m.id === anchorId && m.content === "");

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto px-5 py-4 space-y-4"
        aria-live="polite"
        aria-label="Cuộc trò chuyện với agent"
      >
        {isEmpty ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              className="!bg-transparent !border-0"
              message="Chưa có tin nhắn nào. Gõ lệnh bên dưới để agent bắt đầu quan sát và thực thi."
            />
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MemoBubble
                key={msg.id}
                message={msg}
                /* Chặng đang chạy chỉ chảy vào ĐÚNG bong bóng anchor của lượt
                   này. Truyền cho mọi bong bóng thì lượt cũ cũng hiện lại chặng
                   của lượt mới. */
                liveSteps={runId !== null && msg.id === anchorId ? liveSteps : undefined}
                streamingContent={
                  anchorAwaitingText && msg.id === anchorId ? (streamingContent ?? undefined) : undefined
                }
                /* Suy nghĩ ĐANG chảy về chỉ thuộc bong bóng anchor của lượt
                   này. Suy nghĩ đã chốt nằm sẵn trên chính tin nhắn. */
                streamingThought={
                  runId !== null && msg.id === anchorId ? (streamingThought?.content ?? undefined) : undefined
                }
                showCameraLink
                onRetry={onRetry}
              />
            ))}

            {/* Bong bóng streaming RỜI chỉ còn dùng cho câu trả lời thứ hai trở
                đi của một lượt. Câu đầu tiên đã chảy vào bong bóng anchor ở
                trên, nên không có khối nào nổi ở đáy rồi nhảy lên nữa. */}
            {streamingContent && !anchorAwaitingText && (
              <StreamingBubble
                content={streamingContent}
                thought={anchorId === null ? streamingThought?.content : undefined}
              />
            )}
          </>
        )}
      </div>

      {/* Jump-to-latest — shown while auto-scroll is paused. Solid panel, never
          glass (MASTER §9.2). */}
      {!pinnedToBottom && !isEmpty && (
        <button
          type="button"
          onClick={() => {
            scrollToBottom();
            setPinnedToBottom(true);
          }}
          className="panel absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 text-[13px] font-medium text-paper-50 inline-flex items-center gap-1.5 z-10 focus-ring cursor-pointer hover:border-[var(--line-strong)]"
        >
          <ArrowDown size={14} />
          Tin nhắn mới
        </button>
      )}
    </div>
  );
}
