"use client";
/* MessageBubble — P04 §3
   User: right, arc-500. Agent: left, ink-800 + hairline.
   Tool cards nest inside the assistant bubble, in conversation order
   (MASTER §13.1) — never in their own bubble, never batched at the end. */

import { Fragment, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { Message, AgentStep } from "@/stores";
import { AgentTrace } from "./AgentTrace";
import { ThinkingBlock } from "./ThinkingBlock";
import { useSmoothText } from "@/hooks/useSmoothText";
import { isTraceHiddenTool } from "@/lib/tool-display";
import { stripControlTokens, hasVisibleText } from "@/lib/agent-text";

interface MessageBubbleProps {
  message: Message;
  /** Chặng đang chạy, lấy từ store. CÓ giá trị nghĩa là lượt chạy chưa xong và
      bong bóng này là anchor của nó; `undefined` thì đọc chặng đã chốt trên
      chính tin nhắn. Một prop quyết định cả nguồn dữ liệu lẫn trạng thái chạy,
      nên không thể lệch nhau. */
  liveSteps?: AgentStep[];
  /** Chữ đang stream, khi bong bóng này là nơi câu trả lời sẽ hiện ra. Render
      TRONG bong bóng chứ không dựng bong bóng riêng — nếu không, một lượt chạy
      sẽ ra hai bong bóng: một chứa trace, một chứa chữ. */
  streamingContent?: string;
  /** Suy nghĩ đang chảy về, khi bong bóng này là nơi nó thuộc về. Cùng lý do
      với `streamingContent`: render TRONG bong bóng, không dựng khối riêng. */
  streamingThought?: string;
  showCameraLink?: boolean;
  onRetry?: (message: Message) => void;
}

/* A deliberately narrow inline renderer: **bold**, *italic* and `code` only.
   Anything else stays literal text, so agent output can never inject markup. */
function renderInline(text: string): ReactNode {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  return text.split(pattern).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="font-mono text-[12.5px] bg-ink-900 px-1 py-0.5 rounded">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function renderContent(content: string): ReactNode {
  return content.split("\n").map((line, i) => (
    <span key={i} className="block">
      {renderInline(line)}
    </span>
  ));
}

export function MessageBubble({
  message,
  liveSteps,
  streamingContent,
  streamingThought,
  showCameraLink,
  onRetry,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  /* Gõ ra theo nhịp đều thay vì theo nhịp gói tin SSE. Chỉ cho phần đang
      stream — chữ đã chốt hiện ngay, không ai muốn xem gõ lại lịch sử. */
  const smoothStream = useSmoothText(streamingContent ?? "", streamingContent !== undefined);

  /* Điều kiện này phải khớp CHÍNH XÁC với điều kiện hiện/ẩn trong `AgentTrace`:
     ở đó khối chỉ hiện khi có ít nhất một dòng tool, nên đếm ở đây cũng phải là
     tool NHÌN THẤY ĐƯỢC — không tính chặng giai đoạn, và bỏ qua tool bị ẩn khỏi
     trace (`get_task_status`).

     Lệch nhau là ra bong bóng RỖNG: `AgentTrace` trả `null`, tin nhắn chưa có
     chữ, nhưng khung bong bóng vẫn vẽ ra một ô trống lơ lửng giữa hội thoại.
     Đó chính là thứ xảy ra với câu chào, khi agent có chặng nhưng không gọi
     tool nào. */
  const hasVisibleTool = (message.tool_calls ?? []).some(
    (call) => !isTraceHiddenTool(call.tool_name),
  );

  /* Hàng rào cuối cùng cho token điều khiển. Backend đã tách chúng ra từ
     `server/harmony.py`, nhưng những tin nhắn LƯU TỪ TRƯỚC khi có bộ tách vẫn
     mang nguyên `<|channel|>thought` trong nội dung — và chúng vẫn được cuộn
     lại để đọc. */
  const content = isUser ? message.content : stripControlTokens(message.content);

  /* HAI khối suy nghĩ, không phải một.
     `message.thinking` là những đoạn đã chốt của lượt này (agent nghĩ nhiều lần
     — trước mỗi vòng tool một lần). `streamingThought` là đoạn ĐANG chảy về.
     Bản trước lấy `message.thinking ?? streamingThought`, nên từ vòng thứ hai
     trở đi đoạn đang nghĩ bị che hoàn toàn: agent im lặng hàng chục giây mà
     màn hình không có gì động. */
  const sealedThinking = message.thinking;
  const liveThinking = streamingThought?.trim() ? streamingThought : undefined;

  /* Bong bóng anchor được mở RỖNG ngay từ `run.started`. Nếu lượt chạy hỏng
     trước khi có bất cứ thứ gì, đừng để lại một ô trống lơ lửng. */
  if (
    !isUser &&
    !hasVisibleText(content) &&
    !streamingContent &&
    !hasVisibleTool &&
    !sealedThinking?.trim() &&
    !liveThinking
  )
    return null;
  const failed = message.send_status === "failed";
  const absoluteTime = new Date(message.created_at).toLocaleString("vi-VN");

  return (
    <div className={`group flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`${
          isUser
            ? `max-w-[76%] bg-arc-500 text-white rounded-2xl rounded-br-md ${failed ? "opacity-70" : ""}`
            : "max-w-[86%] bg-ink-800 text-paper-50 border border-[var(--line)] rounded-2xl rounded-bl-md"
        } px-4 py-3 text-[14px] leading-[1.5] break-words`}
      >
        {/* Chặng đường đứng TRƯỚC câu trả lời: agent làm xong rồi mới nói,
            không phải ngược lại.

            Một khối duy nhất cho cả giai đoạn lẫn tool — danh sách `ToolCard`
            rời phía dưới đã bỏ, vì nó kể lại đúng những việc trace vừa kể. */}
        {/* `!isUser` là hàng rào THỨ HAI, cố ý trùng với điều kiện ở
            `fetchMessages`. Trace là việc agent làm; nó không có nghĩa gì trong
            bong bóng của người dùng. Một chỗ nào đó gắn nhầm dữ liệu vào tin
            nhắn user thì chặn ở đây, thay vì hiện ra rồi mới phát hiện. */}
        {/* Suy nghĩ ĐÃ CHỐT đứng trước chặng đường: agent nghĩ rồi mới làm, và
            thứ tự trên màn hình phải đọc ra đúng như vậy. */}
        {!isUser && sealedThinking && (
          <ThinkingBlock text={sealedThinking} durationMs={message.thinking_ms} />
        )}

        {!isUser && (
          <AgentTrace
            steps={liveSteps ?? message.agent_steps}
            toolCalls={message.tool_calls}
            running={liveSteps !== undefined}
            showCameraLink={showCameraLink}
          />
        )}

        {/* Suy nghĩ ĐANG chảy đứng SAU chặng đường và ngay trên câu trả lời:
            đó đúng là chỗ của nó trong dòng thời gian — agent vừa làm xong mấy
            việc ở trên, giờ đang nghĩ xem nói gì. */}
        {!isUser && liveThinking && <ThinkingBlock text={liveThinking} streaming />}

        {hasVisibleText(content) ? (
          <div>{renderContent(content)}</div>
        ) : streamingContent !== undefined ? (
          <div>
            {smoothStream}
            <span className="inline-block w-1.5 h-4 align-text-bottom bg-arc-400 rounded-full ml-0.5 animate-pulse-dot" />
          </div>
        ) : null}

        {/* KHÔNG có chân "HOÀN THÀNH · Xem trace" ở đây.

            Badge đó nói trạng thái LƯỢT CHẠY — agent đã chạy hết vòng mà không
            gặp lỗi kỹ thuật. Nhưng đặt ngay dưới câu "Robot đã nhặt thành công
            chiếc cốc", nó đọc ra thành xác nhận rằng VIỆC KIA đã xong. Hai điều
            khác hẳn nhau: lượt chạy hoàn thành không có nghĩa cánh tay đã làm
            được gì, nhất là khi chưa nối robot thật.

            Trạng thái lượt chạy vẫn xem được đầy đủ ở trang Nhật ký, nơi nó
            đứng cạnh đúng ngữ cảnh của nó thay vì cạnh một câu tường thuật. */}
      </div>

      {/* Failed send — inline retry, never an auto-retry (P04 §6) */}
      {isUser && failed && (
        <div className="mt-1 flex items-center gap-2 text-[12px] text-halt-500">
          <span>Gửi thất bại.</span>
          <button
            type="button"
            onClick={() => onRetry?.(message)}
            className="inline-flex items-center gap-1 underline hover:no-underline focus-ring rounded cursor-pointer"
          >
            <RotateCw size={12} />
            Gửi lại
          </button>
        </div>
      )}

      {/* Timestamp — appears on hover or keyboard focus within the bubble */}
      <time
        dateTime={message.created_at}
        title={absoluteTime}
        className="eyebrow mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[120ms]"
      >
        {new Date(message.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
      </time>
    </div>
  );
}
