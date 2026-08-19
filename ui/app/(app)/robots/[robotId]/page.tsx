"use client";
/* P10 — CHI TIẾT ROBOT
   Trả lời "cỗ máy này đang hoạt động ra sao?". Mọi hành động ở đây theo ma trận
   §11.2, và nút nào bị khoá đều nói rõ lý do.

   Không còn "Ngắt kết nối robot": luồng ghép nối đã bỏ khỏi sản phẩm, nên gỡ
   robot ra sẽ là cửa một chiều — giao diện không có đường nào nối lại. Nút Dừng
   thì không bao giờ có hộp thoại xác nhận (§12.1). */

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Cpu, Home, TriangleAlert, ShieldCheck, Video } from "lucide-react";

import { RobotStatusBadge } from "@/components/robot-state/RobotStatusBadge";
import { HaltButton } from "@/components/robot-state/HaltButton";
import { JointTable } from "@/components/robot-state/JointTable";
import { DisabledHint } from "@/components/common/DisabledHint";
import { ErrorPanel } from "@/components/common/ErrorMessage";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/common/Skeleton";

import {
  fetchMockCameraHealth,
  type CameraHealth,
} from "@/lib/mock/robots";
/* Chỉ còn `fetchMockCameraHealth` là mock: Edge không có tool nào trả fps hay
   tuổi khung hình của từng camera, nên đơn giản là chưa có nguồn. Mọi thứ khác
   trên trang này đã đi qua backend. */
import {
  fetchRobot,
  fetchRobotStats,
  goHomeRobot,
  resetRobotError,
  type RobotStats,
} from "@/lib/api/robots";
import { actionAvailability } from "@/lib/robot-actions";
import { errorText, toErrorObject, type ErrorObject } from "@/lib/errors";
import { toast, type Robot } from "@/stores";

/* ---------------------------------------------------------------- cards */

function CameraHealthCard({ cameras }: { cameras: CameraHealth[] }) {
  if (cameras.length === 0) return null;
  return (
    <div className="panel p-4">
      <h2 className="eyebrow mb-3 flex items-center gap-2">
        <Video size={13} /> Sức khoẻ camera
      </h2>
      <div className="space-y-2.5">
        {cameras.map((cam) => {
          const stale = cam.last_frame_age_s > 5;
          return (
            <div key={cam.camera} className="flex items-center justify-between text-[13px]">
              <span className="text-haze-300">{cam.camera === "top" ? "Camera trên" : "Camera cổ tay"}</span>
              <span className="flex items-center gap-3">
                <span className="data text-[12px]">{cam.fps} FPS</span>
                <span className={`data text-[11.5px] ${stale ? "text-halt-500" : "text-haze-500"}`}>
                  khung hình cuối {cam.last_frame_age_s}s trước
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Khoá theo TRẠNG THÁI LƯỢT CHẠY thật trong database, không phải outcome của
   episode — hệ thống chưa lưu episode nào xuống đĩa. */
const STATUS_STYLE: Record<string, { bar: string; label: string }> = {
  COMPLETED: { bar: "bg-jade-400", label: "Hoàn thành" },
  FAILED: { bar: "bg-halt-500", label: "Thất bại" },
  TIMEOUT: { bar: "bg-amber-400", label: "Quá giờ" },
  CANCELLED: { bar: "bg-haze-500", label: "Đã huỷ" },
  RUNNING: { bar: "bg-arc-500", label: "Đang chạy" },
  WAITING_TOOL: { bar: "bg-arc-500", label: "Chờ tool" },
};

function RunStatsCard({ stats }: { stats: RobotStats }) {
  const total = stats.outcomes.reduce((sum, o) => sum + o.count, 0) || 1;
  return (
    <div className="panel p-4">
      <h2 className="eyebrow mb-3">Thống kê {stats.window_days} ngày</h2>
      <div className="flex items-end justify-between mb-4">
        <div>
          <p className="font-mono text-[28px] tabular-nums text-paper-50 leading-none">{stats.total_runs}</p>
          <p className="eyebrow mt-1">Lượt thực thi</p>
        </div>
        <div className="text-right">
          {/* `success_rate` là `null` khi chưa lượt nào kết thúc — hiện dấu
              gạch chứ không phải 0%, vì 0% đọc ra là "hỏng hết". */}
          <p className="font-mono text-[28px] tabular-nums text-jade-400 leading-none">
            {stats.success_rate === null ? "—" : `${Math.round(stats.success_rate * 100)}%`}
          </p>
          <p className="eyebrow mt-1">Thành công</p>
        </div>
      </div>

      {/* Colours are keyed to outcome semantics — MASTER §4.1 */}
      <div className="h-2 flex rounded-full overflow-hidden" role="img" aria-label={`Tỉ lệ kết quả ${stats.window_days} ngày`}>
        {stats.outcomes.map((o) => (
          <div
            key={o.status}
            className={STATUS_STYLE[o.status]?.bar ?? "bg-ink-700"}
            style={{ width: `${(o.count / total) * 100}%` }}
            title={`${STATUS_STYLE[o.status]?.label ?? o.status}: ${o.count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {stats.outcomes.map((o) => (
          <span key={o.status} className="flex items-center gap-1.5 text-[11.5px] text-haze-500">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[o.status]?.bar ?? "bg-ink-700"}`} />
            {STATUS_STYLE[o.status]?.label ?? o.status}
            <span className="data text-[11px]">{o.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export default function RobotDetailPage() {
  const params = useParams();
  const router = useRouter();
  const robotId = (params?.robotId as string) ?? "";

  const [robot, setRobot] = useState<Robot | null>(null);
  const [cameras, setCameras] = useState<CameraHealth[]>([]);
  const [stats, setStats] = useState<RobotStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");
  const [error, setError] = useState<ErrorObject | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [showRawRegisters, setShowRawRegisters] = useState(false);
  const [actionError, setActionError] = useState<ErrorObject | null>(null);
  const [busyAction, setBusyAction] = useState<"home" | "reset" | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRobot(robotId), fetchMockCameraHealth(robotId), fetchRobotStats(robotId)])
      .then(([robotData, cameraData, statsData]) => {
        if (cancelled) return;
        if (!robotData) {
          setState("missing");
          return;
        }
        setRobot(robotData);
        setCameras(cameraData);
        setStats(statsData);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(toErrorObject(err));
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [robotId, attempt]);

  const reload = useCallback(() => {
    setState("loading");
    setError(null);
    setAttempt((a) => a + 1);
  }, []);

  const goHome = useCallback(async () => {
    if (!robot) return;
    setBusyAction("home");
    setActionError(null);
    try {
      await goHomeRobot(robot.id);
      /* Đọc lại trạng thái từ backend thay vì tin vào giá trị trả về của lệnh:
         lệnh chỉ nói "đã gửi", còn cánh tay ở đâu thì phải hỏi lại. */
      const updated = await fetchRobot(robot.id);
      if (updated) setRobot(updated);
      toast.success("Đã gửi lệnh về vị trí home.");
    } catch (err) {
      setActionError(toErrorObject(err));
    } finally {
      setBusyAction(null);
    }
  }, [robot]);

  const resetError = useCallback(async () => {
    if (!robot) return;
    setBusyAction("reset");
    setActionError(null);
    try {
      await resetRobotError(robot.id);
      const updated = await fetchRobot(robot.id);
      if (updated) setRobot(updated);
      toast.success("Đã gửi lệnh xoá cờ lỗi.");
    } catch (err) {
      setActionError(toErrorObject(err));
    } finally {
      setBusyAction(null);
    }
  }, [robot]);


  /* ---- states ---- */

  if (state === "loading") {
    return (
      <div className="p-6 max-w-[1440px] mx-auto space-y-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-3">
          <Skeleton className="h-[320px] rounded-xl" />
          <Skeleton className="h-[240px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (state === "error" && error) {
    return (
      <div className="p-6 max-w-[720px] mx-auto mt-10">
        <ErrorPanel error={error} onRetry={reload} />
      </div>
    );
  }

  if (state === "missing" || !robot) {
    return (
      <div className="p-6 max-w-[720px] mx-auto mt-10">
        <EmptyState
          message="Không tìm thấy robot này. Có thể nó đã được ngắt ghép nối."
          action={
            <button type="button" onClick={() => router.push("/dashboard")} className="btn-primary focus-ring">
              Về Tổng quan
            </button>
          }
        />
      </div>
    );
  }

  const halt = actionAvailability("halt", robot.robot_status, robot.connection_status);
  const home = actionAvailability("goHome", robot.robot_status, robot.connection_status);
  const reset = actionAvailability("resetError", robot.robot_status, robot.connection_status);
  const offline = robot.connection_status === "OFFLINE";

  return (
    <div className={`p-4 sm:p-6 max-w-[1440px] mx-auto space-y-4 ${offline ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="display-l text-paper-50">{robot.name}</h1>
          <RobotStatusBadge robotStatus={robot.robot_status} connectionStatus={robot.connection_status} />
          <span className="eyebrow flex items-center gap-2">
            <span>{robot.model}</span>
            <span aria-hidden="true">·</span>
            <span className="data text-[11.5px] text-haze-500">v{robot.edge_version}</span>
          </span>
        </div>
        <HaltButton robotId={robot.id} visible={halt.state !== "hidden"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-3">
        {/* Left column */}
        <div className="space-y-3 min-w-0">
          <section className="panel p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="eyebrow flex items-center gap-2">
                <Cpu size={13} /> Trạng thái {robot.joints.length} khớp
              </h2>
              <label className="flex items-center gap-2 text-[12px] text-haze-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRawRegisters}
                  onChange={(e) => setShowRawRegisters(e.target.checked)}
                  className="accent-arc-500 focus-ring"
                />
                Hiện thanh ghi thô
              </label>
            </div>

            <JointTable joints={robot.joints} detailed />

            {showRawRegisters && (
              <div className="mt-3 panel-inset p-3 overflow-x-auto">
                <p className="eyebrow mb-2">Thanh ghi thô</p>
                <pre className="log-text text-haze-300">
                  {robot.joints
                    .map((j) =>
                      [
                        j.name.padEnd(15),
                        `qpos=${j.present_position.toFixed(3).padStart(9)}`,
                        `ctrl=${(j.target_position ?? NaN).toFixed(3).padStart(9)}`,
                        `qvel=${(j.present_velocity ?? NaN).toFixed(3).padStart(8)}`,
                        `frc=${(j.torque_nm ?? NaN).toFixed(3).padStart(7)}`,
                        `range=[${j.range_min ?? -180},${j.range_max ?? 180}]`,
                      ].join("  "),
                    )
                    .join("\n")}
                </pre>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CameraHealthCard cameras={cameras} />
            {stats && <RunStatsCard stats={stats} />}
          </div>
        </div>

        {/* Right column */}
        <aside className="panel p-4 space-y-4 h-fit">
          <div>
            <h2 className="eyebrow mb-2">Khả năng của thiết bị</h2>
            <table className="w-full font-mono text-[12px]">
              <tbody>
                {robot.capabilities.map((cap) => (
                  <tr key={cap.name} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-1.5 text-haze-300">{cap.name}</td>
                    <td className="py-1.5 text-right text-haze-500">v{cap.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-[var(--line)] pt-4 space-y-2">
            <DisabledHint reason={home.state === "disabled" ? home.reason : undefined} className="w-full">
            <button
              type="button"
              onClick={goHome}
              disabled={home.state !== "enabled" || busyAction === "home"}
              title={home.state === "enabled" ? "Đưa robot về vị trí mặc định" : undefined}
              className="btn-ghost w-full !justify-start border border-[var(--line)] disabled:opacity-40 disabled:cursor-not-allowed focus-ring"
            >
              <Home size={14} />
              {busyAction === "home" ? "Đang về home…" : "Về vị trí home"}
            </button>
            </DisabledHint>

            {/* reset_error is only rendered in ERROR state — §11.2 */}
            {reset.state !== "hidden" && (
              <div className="pt-2">
                <p className="eyebrow mb-1.5">Cờ lỗi hiện tại</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {robot.health.error_flags.length === 0 ? (
                    <span className="text-[12px] text-haze-500">Không có</span>
                  ) : (
                    robot.health.error_flags.map((flag) => (
                      <span key={flag} className="data text-[11px] px-2 py-0.5 rounded bg-halt-500/12 text-halt-500">
                        {flag}
                      </span>
                    ))
                  )}
                </div>
                <DisabledHint reason={reset.state === "disabled" ? reset.reason : undefined} className="w-full">
                <button
                  type="button"
                  onClick={resetError}
                  disabled={reset.state !== "enabled" || busyAction === "reset"}
                  title={reset.state === "enabled" ? "Xoá cờ lỗi để ra lệnh tiếp" : undefined}
                  className="btn-ghost w-full !justify-start border border-[var(--line)] disabled:opacity-40 disabled:cursor-not-allowed focus-ring"
                >
                  <ShieldCheck size={14} />
                  {busyAction === "reset" ? "Đang xoá lỗi…" : "Xoá lỗi"}
                </button>
                </DisabledHint>
              </div>
            )}

            {/* Errors from an action land next to that action, never in a toast */}
            {actionError && (
              <p className="flex items-start gap-1.5 text-[12.5px] text-halt-500 pt-1">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                {errorText(actionError)}
              </p>
            )}
          </div>
        </aside>
      </div>

    </div>
  );
}
