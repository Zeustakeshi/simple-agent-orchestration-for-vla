"use client";
/* EpisodeProgress — P04 §5
   The "robot action" link in the chain (MASTER §13.1). While running it shows
   live step count; on completion the fill and text switch by `outcome`.
   Every varying number uses .data + tabular-nums (MASTER §5). */

import { useUiPreferenceStore, type Episode, type EpisodeOutcome } from "@/stores";

const OUTCOME: Record<
  EpisodeOutcome,
  { fill: string; text: string; label: (ep: Episode) => string }
> = {
  SUCCESS: {
    fill: "bg-jade-400",
    text: "text-jade-400",
    label: (ep) => `Hoàn thành sau ${ep.steps} bước`,
  },
  STOPPED: {
    fill: "bg-haze-500",
    text: "text-haze-500",
    label: () => "Đã dừng theo yêu cầu",
  },
  TIMEOUT: {
    fill: "bg-amber-400",
    text: "text-amber-400",
    label: () => "Quá thời gian chờ trước khi xong",
  },
  MAX_STEPS: {
    fill: "bg-amber-400",
    text: "text-amber-400",
    label: (ep) => `Đã chạm giới hạn ${ep.max_steps} bước`,
  },
  SAFETY_ABORT: {
    fill: "bg-halt-500",
    text: "text-halt-500",
    label: (ep) => ep.stop_reason ?? "Dừng vì lý do an toàn",
  },
};

interface EpisodeProgressProps {
  episode: Episode;
  /** Hide the instruction line — `go_home` has no instruction (P04 §4). */
  hideInstruction?: boolean;
  /** Show the "Xem camera" shortcut (only meaningful on the control page). */
  showCameraLink?: boolean;
}

export function EpisodeProgress({ episode, hideInstruction, showCameraLink }: EpisodeProgressProps) {
  const setArtifactTab = useUiPreferenceStore((s) => s.setArtifactTab);
  const running = !episode.outcome;
  const percent = episode.max_steps > 0 ? Math.round((episode.steps / episode.max_steps) * 100) : 0;
  const outcome = episode.outcome ? OUTCOME[episode.outcome] : null;
  const fill = outcome?.fill ?? "bg-arc-500";

  return (
    <div className="panel-inset p-3 space-y-2">
      {!hideInstruction && episode.instruction && (
        <p className="text-[12.5px] text-haze-300">
          {running ? "Đang thực thi: " : "Nhiệm vụ: "}
          <span className="text-paper-50">&ldquo;{episode.instruction}&rdquo;</span>
        </p>
      )}

      <div
        className="h-1.5 rounded-full bg-ink-700 overflow-hidden"
        role="progressbar"
        aria-valuenow={episode.steps}
        aria-valuemin={0}
        aria-valuemax={episode.max_steps}
        aria-label="Tiến độ thực thi"
      >
        <div
          className={`h-full rounded-full ${fill} transition-[width] duration-200 ease-linear`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className={`text-[12.5px] ${outcome?.text ?? "text-haze-300"}`}>
          {outcome ? outcome.label(episode) : "Đang thực thi"}
        </span>
        <div className="flex items-center gap-3">
          <span className="data text-[11.5px] text-haze-500">
            bước {episode.steps}/{episode.max_steps} ({percent}%)
          </span>
          <span className="data text-[11.5px] text-haze-500">{episode.duration_s}s</span>
          {showCameraLink && running && (
            <button
              type="button"
              onClick={() => setArtifactTab("camera")}
              className="btn-ghost !h-7 !px-2 !text-[12px] focus-ring"
            >
              Xem camera
            </button>
          )}
        </div>
      </div>

      {/* SAFETY_ABORT gets an explicit next step, not just a colour change. */}
      {episode.outcome === "SAFETY_ABORT" && (
        <p className="text-[12px] text-haze-300 border-t border-[var(--line)] pt-2">
          Kiểm tra vùng làm việc và xoá lỗi ở trang robot trước khi ra lệnh tiếp.
        </p>
      )}
    </div>
  );
}
