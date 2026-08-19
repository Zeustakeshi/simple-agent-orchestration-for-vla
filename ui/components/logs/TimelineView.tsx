import type { RunSource, ToolCall, ToolStatus } from "@/stores";
import { formatAbsolute } from "@/lib/format";
import { StatusBadge } from "@/components/common/StatusBadge";

export type TimelineEntry =
  | { kind: "run_started"; at: string; source: RunSource | string }
  | {
      kind: "llm_call";
      at: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      duration_ms: number;
    }
  | { kind: "tool_call"; at: string; toolCall: ToolCall }
  | { kind: "run_completed"; at: string; ok: boolean; outcome: string };

interface TimelineViewProps {
  entries: TimelineEntry[];
}

const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  PENDING: "Chờ",
  RUNNING: "Đang chạy",
  SUCCEEDED: "Xong",
  FAILED: "Lỗi",
  CANCELLED: "Huỷ",
  TIMEOUT: "Hết hạn",
};

function ToolStatusChip({ status }: { status: ToolStatus }) {
  const tone =
    status === "SUCCEEDED"
      ? "bg-jade-400/15 text-jade-400"
      : status === "FAILED"
        ? "bg-halt-500/15 text-halt-500"
        : status === "RUNNING"
          ? "bg-arc-500/15 text-arc-400"
          : "bg-ink-700 text-haze-500";
  return (
    <span
      className={`inline-flex items-center h-5 px-2 rounded-full text-[10.5px] font-medium uppercase tracking-[0.06em] ${tone}`}
    >
      {TOOL_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function EntryLabel({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case "run_started":
      return (
        <>
          <span className="text-paper-50">Bắt đầu lượt chạy</span>
          <StatusBadge kind="source" value={entry.source} />
        </>
      );
    case "llm_call":
      return (
        <>
          <span className="text-paper-50">Gọi mô hình</span>
          <span className="data text-[11.5px] text-haze-500">
            {entry.model} · {entry.input_tokens}+{entry.output_tokens} token · {entry.duration_ms}ms
          </span>
        </>
      );
    case "tool_call":
      return (
        <>
          <span className="text-paper-50">{entry.toolCall.tool_name}</span>
          <ToolStatusChip status={entry.toolCall.status} />
          {entry.toolCall.duration_ms != null && (
            <span className="data text-[11.5px] text-haze-500">{entry.toolCall.duration_ms}ms</span>
          )}
        </>
      );
    case "run_completed":
      return (
        <>
          <span className={entry.ok ? "text-jade-400" : "text-halt-500"}>
            {entry.ok ? "Hoàn thành" : "Kết thúc lỗi"}
          </span>
          <span className="text-[12.5px] text-haze-300">{entry.outcome}</span>
        </>
      );
  }
}

export function TimelineView({ entries }: TimelineViewProps) {
  return (
    <ol className="space-y-3">
      {entries.map((entry, index) => (
        <li key={`${entry.kind}-${entry.at}-${index}`} className="flex gap-3">
          <div className="flex flex-col items-center pt-1">
            <span className="w-2 h-2 rounded-full bg-arc-500 shrink-0" />
            {index < entries.length - 1 && <span className="w-px flex-1 bg-[var(--line)] mt-1" />}
          </div>
          <div className="min-w-0 flex-1 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <EntryLabel entry={entry} />
            </div>
            <p className="eyebrow mt-1 normal-case tracking-normal">{formatAbsolute(entry.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
