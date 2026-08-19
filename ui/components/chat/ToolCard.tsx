"use client";
/* ToolCard — P04 §4 ⭐
   Khung thẻ độc lập cho một tool call: viền trái theo trạng thái, header là
   `<button aria-expanded>` thật, phần thân do `ToolCallBody` render.

   GIỮ FILE NÀY DÙ TRONG CHAT KHÔNG CÒN DÙNG. Từ khi agent trace gộp mọi hành
   động vào một danh sách, `MessageBubble` không render thẻ rời nữa. Nhưng
   `01-PAGES-UI.md:569` yêu cầu timeline chi tiết lượt chạy (P09) "dùng lại đúng
   component ToolCard của P04", và `components/logs/TimelineView.tsx` hiện vẫn
   đang in `tool_name` thô — đây là component nó phải chuyển sang dùng. Xoá đi
   là mất luôn đường đó. */

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Check, X, Loader, Ban, Clock, ChevronDown } from "lucide-react";
import type { ToolCall, ToolStatus } from "@/stores";
import { ToolCallBody } from "./ToolCallBody";
import { TOOL_ICON, DEFAULT_TOOL_ICON, toolLabel, toolArgSummary, isTraceHiddenTool } from "@/lib/tool-display";
import { formatDurationMs } from "@/lib/format";
import { errorText } from "@/lib/errors";

/** Biểu tượng + màu theo trạng thái tool. Export để `AgentTrace` dùng lại thay
    vì tự suy ra màu — hai chỗ lệch nhau thì cùng một lỗi lại đọc ra hai kiểu.

    Ba trạng thái người dùng gặp nhiều nhất tạo thành một bộ đối xứng đọc được
    ngay không cần chú giải: ĐANG CHẠY quay, XONG dấu tích, HỎNG dấu X.
    `X` chứ không phải tam giác cảnh báo — tam giác nói "coi chừng", còn ở đây
    việc đã hỏng rồi, và nó phải bắt cặp thị giác với dấu tích ở dòng trên.

    Hai trạng thái còn lại cố ý KHÁC hình: huỷ và quá giờ không phải lỗi của
    tool, dùng chung dấu X thì mất phân biệt "agent làm sai" với "bị cắt ngang". */
export const TOOL_STATUS_STYLE: Record<
  ToolStatus,
  { border: string; Icon: LucideIcon; iconClass: string }
> = {
  PENDING:   { border: "border-l-arc-500",   Icon: Loader, iconClass: "text-arc-400 animate-spin-slow" },
  RUNNING:   { border: "border-l-arc-500",   Icon: Loader, iconClass: "text-arc-400 animate-spin-slow" },
  SUCCEEDED: { border: "border-l-jade-400",  Icon: Check,  iconClass: "text-jade-400" },
  FAILED:    { border: "border-l-halt-500",  Icon: X,      iconClass: "text-halt-500" },
  CANCELLED: { border: "border-l-haze-500",  Icon: Ban,    iconClass: "text-haze-500" },
  TIMEOUT:   { border: "border-l-amber-400", Icon: Clock,  iconClass: "text-amber-400" },
};

interface ToolCardProps {
  toolCall: ToolCall;
  /** Control page passes true so the episode bar can offer "Xem camera". */
  showCameraLink?: boolean;
}

export function ToolCard({ toolCall, showCameraLink }: ToolCardProps) {
  // Failures start open — the user shouldn't have to hunt for the reason.
  const [expanded, setExpanded] = useState(toolCall.status === "FAILED");

  if (isTraceHiddenTool(toolCall.tool_name)) return null;

  const status = TOOL_STATUS_STYLE[toolCall.status] ?? TOOL_STATUS_STYLE.PENDING;
  const ToolIcon = TOOL_ICON[toolCall.tool_name] ?? DEFAULT_TOOL_ICON;

  const collapsedLine = (() => {
    switch (toolCall.status) {
      case "SUCCEEDED": {
        const duration = formatDurationMs(toolCall.duration_ms);
        return duration ? `Xong · ${duration}` : "Xong";
      }
      case "FAILED":
        return toolCall.error ? errorText(toolCall.error) : "Thất bại";
      case "CANCELLED":
        return "Đã huỷ";
      case "TIMEOUT":
        return "Quá thời gian chờ";
      default:
        return toolArgSummary(toolCall);
    }
  })();

  return (
    <div className={`panel-inset p-3 my-2 text-[13px] border-l-2 ${status.border}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 text-left focus-ring rounded cursor-pointer"
      >
        <status.Icon size={14} className={`shrink-0 ${status.iconClass}`} />
        <ToolIcon size={14} className="text-haze-300 shrink-0" />
        <span className="font-medium text-paper-50 shrink-0">{toolLabel(toolCall.tool_name)}</span>
        <span
          className={`flex-1 truncate text-[12px] ${toolCall.status === "FAILED" ? "text-halt-500" : "text-haze-500"}`}
        >
          {collapsedLine}
        </span>
        <ChevronDown
          size={14}
          className={`text-haze-500 shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--line)]">
          <ToolCallBody toolCall={toolCall} showCameraLink={showCameraLink} />
        </div>
      )}
    </div>
  );
}
