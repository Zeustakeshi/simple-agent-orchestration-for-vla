/* StatusBadge: one badge for run status, run source and schedule outcome. */

import type { RunSource, RunStatus } from "@/stores";

type BadgeSpec = { label: string; className: string };

const RUN: Record<RunStatus, BadgeSpec> = {
  RUNNING: { label: "Đang chạy", className: "bg-arc-500/15 text-arc-400" },
  WAITING_TOOL: { label: "Chờ tool", className: "bg-arc-500/15 text-arc-400" },
  COMPLETED: { label: "Hoàn thành", className: "bg-jade-400/15 text-jade-400" },
  FAILED: { label: "Thất bại", className: "bg-halt-500/15 text-halt-500" },
  CANCELLED: { label: "Đã huỷ", className: "bg-ink-700 text-haze-500" },
  /* `TIMEOUT` là trạng thái mới của develop; giữ nguyên màu develop chọn.
     GHI CHÚ LỆCH: `TOOL_STATUS_STYLE` trong `ToolCard` để TIMEOUT màu amber,
     tách khỏi FAILED đỏ. Ở đây hai cái cùng đỏ. Không tự ý đổi trong lúc gộp
     nhánh — nhưng đây là chỗ cần thống nhất một lần, có chủ đích. */
  TIMEOUT: { label: "Quá giờ", className: "bg-halt-500/15 text-halt-500" },
  /* `amber` chứ không phải `arc`: đây là trạng thái CHỜ, chưa có gì chạy. Dùng
     `arc` như RUNNING thì hai thứ khác hẳn nhau lại nhìn giống nhau, mà phân
     biệt "đang chạy" với "chờ chạy" chính là việc của trang Nhật ký. */
  SCHEDULED: { label: "Chờ chạy", className: "bg-amber-400/15 text-amber-400" },
};

const SOURCE: Record<RunSource, BadgeSpec> = {
  CHAT: { label: "Trò chuyện", className: "bg-ink-700 text-haze-300" },
  SCHEDULE: { label: "Lịch chạy", className: "bg-ink-700 text-haze-300" },
  MANUAL_RUN: { label: "Chạy tay", className: "bg-ink-700 text-haze-300" },
};

const SCHEDULE_STATE: Record<string, BadgeSpec> = {
  ENABLED: { label: "Đang bật", className: "bg-jade-400/15 text-jade-400" },
  DISABLED: { label: "Đã tắt", className: "bg-ink-700 text-haze-500" },
  AUTO_DISABLED: { label: "Tự tắt", className: "bg-amber-400/15 text-amber-400" },
  SKIPPED: { label: "Bỏ qua", className: "bg-ink-700 text-haze-500" },
  MISFIRED: { label: "Lỡ lịch", className: "bg-ink-700 text-haze-500" },
};

interface StatusBadgeProps {
  kind: "run" | "source" | "schedule";
  value: string;
  size?: "sm" | "md";
}

export function StatusBadge({ kind, value, size = "sm" }: StatusBadgeProps) {
  const table = kind === "run" ? RUN : kind === "source" ? SOURCE : SCHEDULE_STATE;
  const spec = (table as Record<string, BadgeSpec>)[value] ?? {
    label: value,
    className: "bg-ink-700 text-haze-500",
  };
  const sizing = size === "sm" ? "h-5 px-2 text-[10.5px]" : "h-6 px-2.5 text-[11.5px]";

  return (
    <span
      className={`inline-flex items-center shrink-0 rounded-full font-medium uppercase tracking-[0.06em] ${sizing} ${spec.className}`}
    >
      {spec.label}
    </span>
  );
}
