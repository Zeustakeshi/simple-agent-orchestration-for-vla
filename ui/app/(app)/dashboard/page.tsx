"use client";
/* P03 — TỔNG QUAN
   Sản phẩm vận hành đúng MỘT robot, nên trang này không còn là lưới thẻ robot
   mà là trang trạng thái của chính con robot đó — trả lời thẳng câu hỏi của
   MASTER §2.2: "Robot của tôi hiện đang thế nào?"

   Làm mới mỗi 15s, không dùng SSE (P03). Mỗi vùng tự lo bốn trạng thái của nó:
   query robot hỏng thì hai khối dưới vẫn render bình thường (§14.3). */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { RobotStatusBadge } from "@/components/robot-state/RobotStatusBadge";
import { jointLabel } from "@/components/robot-state/JointTable";
import { HaltButton } from "@/components/robot-state/HaltButton";
import { TelemetryChart } from "@/components/robot-state/TelemetryChart";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorPanel } from "@/components/common/ErrorMessage";
import { Skeleton } from "@/components/common/Skeleton";
import { DisabledHint } from "@/components/common/DisabledHint";

/* Thống kê giờ đến từ `GET /robots/{id}/stats` — tính trong SQLite từ bảng
   `runs` thật. `PRIMARY_ROBOT_ID` chỉ còn dùng làm robot mặc định khi chưa
   chọn con nào. */
import { PRIMARY_ROBOT_ID } from "@/lib/mock/robots";
import {
  fetchRobots,
  fetchRobotStats,
  type RobotStats,
  type DailyActivity,
} from "@/lib/api/robots";
import { fetchRuns } from "@/lib/api/runs";
import { fetchSchedules } from "@/lib/api/schedules";
import { actionAvailability } from "@/lib/robot-actions";
import { toErrorObject, type ErrorObject } from "@/lib/errors";
import { formatRelative, formatAbsolute, formatDuration } from "@/lib/format";
import { useRealtimeStore, type Robot, type Run, type Schedule } from "@/stores";

const ROBOT_REFETCH_MS = 15_000;

/* ---------------------------------------------------------------- section */

/** Tiêu đề mốc thời gian. Trang này kể một câu chuyện theo thứ tự: robot đang
    thế nào → sắp có việc gì → vừa qua đã làm những gì. Không có hàng ô thống kê
    riêng: mỗi con số nằm trong đúng khối sở hữu nó, xuất hiện một lần. */
function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 flex-wrap pt-1">
      <h2 className="eyebrow">{title}</h2>
      {meta && <span className="text-[12.5px] text-haze-500">{meta}</span>}
    </div>
  );
}

/* ---------------------------------------------------------------- khớp */

/** Sức khoẻ 6 khớp, gói thành một câu kết luận + sáu thanh liếc được.

    Bảng 8 cột trước đây bắt phải ĐỌC mới biết có ổn không — sai với việc của
    Tổng quan (§P03: "nhìn 3 giây biết robot có ổn không"). Số liệu đầy đủ từng
    khớp vẫn còn nguyên ở trang robot. */
function JointHealth({ robot }: { robot: Robot }) {
  const rows = robot.joints.map((joint) => ({
    joint,
    // Sai số bám: |ctrl − qpos|. Lệch nhiều nghĩa là khớp không theo kịp lệnh.
    drift:
      joint.target_position === undefined
        ? null
        : Math.abs(joint.target_position - joint.present_position),
  }));

  const flagged = robot.joints.filter((j) => j.error_flags.length > 0);
  const drifting = rows.filter((r) => r.drift !== null && r.drift >= 2);

  const verdict =
    flagged.length > 0
      ? { text: `${flagged.length} khớp đang báo cờ lỗi`, className: "text-halt-500" }
      : drifting.length > 0
        ? { text: `${drifting.length} khớp bám lệch trên 2°`, className: "text-amber-400" }
        : { text: "Mọi khớp bám đúng lệnh đặt", className: "text-jade-400" };

  return (
    <div className="border-t border-[var(--line)] pt-3 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="eyebrow">Trạng thái khớp</h3>
        <span className={`text-[12.5px] ${verdict.className}`}>{verdict.text}</span>
      </div>

      {/* Đúng hai đại lượng của hai bảng Joint và Control trong MuJoCo:
          qpos (góc thật) và ctrl (lệnh đặt). Cột Δ là hiệu của chúng — thứ mà
          MuJoCo bắt tự nhẩm, ở đây tính sẵn vì đó mới là con số nói lên bộ điều
          khiển có bám kịp không. Mô-men đi kèm để biết khớp có bị ép quá. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="eyebrow pb-1.5 pr-3 font-medium">Khớp</th>
              <th className="eyebrow pb-1.5 pr-3 font-medium text-right" title="qpos — góc thật của khớp">
                Joint
              </th>
              <th className="eyebrow pb-1.5 pr-3 font-medium text-right" title="ctrl — lệnh đặt cho actuator">
                Control
              </th>
              <th className="eyebrow pb-1.5 pr-3 font-medium text-right" title="ctrl − qpos, sai số bám">
                Δ
              </th>
              <th className="eyebrow pb-1.5 font-medium text-right" title="Mô-men sinh ra ở khớp, N·m">
                Mô-men
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ joint, drift }) => (
              <tr key={joint.name} className="border-t border-[var(--line)]">
                <td className="py-1.5 pr-3 text-[12.5px] text-haze-300 whitespace-nowrap">
                  {jointLabel(joint.name)}
                  {joint.error_flags.length > 0 && (
                    <span className="data text-[10.5px] ml-1.5 px-1 py-0.5 rounded bg-halt-500/12 text-halt-500">
                      {joint.error_flags[0]}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-3 data text-[12px] text-right whitespace-nowrap">
                  {joint.present_position.toFixed(2)}°
                </td>
                <td className="py-1.5 pr-3 data text-[12px] text-right whitespace-nowrap text-haze-300">
                  {joint.target_position === undefined ? "—" : `${joint.target_position.toFixed(2)}°`}
                </td>
                <td
                  className={`py-1.5 pr-3 data text-[12px] text-right whitespace-nowrap ${
                    drift === null
                      ? "text-haze-500"
                      : drift >= 5
                        ? "text-halt-500"
                        : drift >= 2
                          ? "text-amber-400"
                          : "text-haze-500"
                  }`}
                >
                  {joint.target_position === undefined
                    ? "—"
                    : `${joint.target_position - joint.present_position >= 0 ? "+" : ""}${(joint.target_position - joint.present_position).toFixed(2)}°`}
                </td>
                <td className="py-1.5 data text-[12px] text-right whitespace-nowrap">
                  {joint.torque_nm === undefined ? "—" : `${joint.torque_nm.toFixed(2)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="eyebrow normal-case tracking-normal">
        Joint = qpos, góc thật · Control = ctrl, lệnh đặt · Δ = chênh giữa hai
        cột · Mô-men tính bằng N·m
      </p>

    </div>
  );
}

/* ---------------------------------------------------------------- thống kê */

/** Vòng tỉ lệ. Cùng một con số nhưng đọc được bằng ngoại vi: cung tròn đầy tới
    đâu thấy ngay tới đó, không phải so sánh chữ số. Dựng bằng SVG chứ không kéo
    Recharts vào — một cung tròn không đáng một thư viện biểu đồ (§16). */
function Gauge({ value, label }: { value: number; label: string }) {
  const size = 92;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(value, 0), 1);
  const tone = pct >= 0.9 ? "var(--jade-400)" : pct >= 0.75 ? "var(--amber-400)" : "var(--halt-500)";

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--ink-700)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${pct * circumference} ${circumference}`}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[20px] tabular-nums text-paper-50">
          {Math.round(pct * 100)}%
        </span>
      </div>
      <span className="eyebrow">{label}</span>
    </div>
  );
}

/** Cột hoạt động theo ngày. Cho thấy nhịp làm việc — hôm nào chạy nhiều, hôm
    nào nghỉ — thứ mà một con số tổng không nói được. */
function ActivityBars({ data, days }: { data: DailyActivity[]; days: number }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="eyebrow">Hoạt động {days} ngày</span>
        <span className="data text-[11.5px] text-haze-500">{total} lượt</span>
      </div>

      <div className="flex items-end gap-1 h-[68px]" role="img" aria-label={`Hoạt động ${days} ngày, tổng ${total} lượt`}>
        {data.map((day) => (
          <div
            key={day.date}
            className="flex-1 min-w-0 bg-arc-500/35 hover:bg-arc-500/55 rounded-sm transition-colors duration-[120ms]"
            style={{ height: `${Math.max((day.count / max) * 100, 4)}%` }}
            title={`${new Date(day.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}: ${day.count} lượt`}
          />
        ))}
      </div>

      <div className="flex justify-between mt-1.5">
        <span className="eyebrow normal-case tracking-normal">
          {new Date(data[0].date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
        </span>
        <span className="eyebrow normal-case tracking-normal">Hôm nay</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- outcome */

/* Khoá là TRẠNG THÁI LƯỢT CHẠY có thật trong database, không phải outcome của
   episode (SUCCESS / SAFETY_ABORT…). Hệ thống chưa lưu episode nào xuống đĩa,
   nên gán nhãn đó là bịa ra một tầng dữ liệu không tồn tại. Màu theo khoá ngữ
   nghĩa §4.1. */
const STATUS_META: Record<string, { label: string; bar: string; text: string }> = {
  COMPLETED: { label: "Hoàn thành", bar: "bg-jade-400", text: "text-jade-400" },
  FAILED: { label: "Thất bại", bar: "bg-halt-500", text: "text-halt-500" },
  TIMEOUT: { label: "Quá giờ", bar: "bg-amber-400", text: "text-amber-400" },
  CANCELLED: { label: "Đã huỷ", bar: "bg-haze-500", text: "text-haze-500" },
  RUNNING: { label: "Đang chạy", bar: "bg-arc-500", text: "text-arc-400" },
  WAITING_TOOL: { label: "Chờ tool", bar: "bg-arc-500", text: "text-arc-400" },
};

/** Kết quả nhiệm vụ 30 ngày — thống kê đúng nghĩa dashboard: một thanh xếp
    chồng cho thấy tỉ lệ, kèm số đếm từng loại. Màu theo khoá ngữ nghĩa §4.1. */
function StatsPanel({ stats }: { stats: RobotStats }) {
  const total = stats.outcomes.reduce((sum, o) => sum + o.count, 0);
  if (total === 0) return null;

  return (
    <section className="panel p-4 space-y-4">
      <div className="flex items-center gap-6 flex-wrap sm:flex-nowrap">
        {/* Chưa lượt nào kết thúc thì KHÔNG vẽ vòng tròn: `success_rate` là
            `null`, và vẽ 0% sẽ đọc ra "hỏng hết" trong khi thật ra là "chưa
            xong cái nào". */}
        {stats.success_rate !== null && <Gauge value={stats.success_rate} label="Thành công" />}
        <ActivityBars data={stats.daily_activity} days={stats.window_days} />
      </div>

      <div className="border-t border-[var(--line)] pt-3">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="eyebrow">Phân loại kết quả</h2>
        <span className="data text-[11.5px] text-haze-500">{total} lượt</span>
      </div>

      <div className="flex h-2 rounded-full overflow-hidden bg-ink-700 mb-3">
        {stats.outcomes
          .filter((o) => o.count > 0)
          .map((o) => (
            <div
              key={o.status}
              className={STATUS_META[o.status]?.bar ?? "bg-haze-500"}
              style={{ width: `${(o.count / total) * 100}%` }}
              title={`${STATUS_META[o.status]?.label ?? o.status}: ${o.count}`}
            />
          ))}
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {stats.outcomes.map((o) => {
          const meta = STATUS_META[o.status];
          return (
            <li key={o.status} className="flex items-center gap-2 text-[12.5px]">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta?.bar ?? "bg-haze-500"}`} />
              <span className="flex-1 text-haze-300 truncate">{meta?.label ?? o.status}</span>
              <span className={`data text-[11.5px] ${o.count > 0 ? (meta?.text ?? "") : "text-haze-500"}`}>
                {o.count}
              </span>
            </li>
          );
        })}
      </ul>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- run */

/** Nhiệm vụ đang chạy. Đây là phần duy nhất của Telemetry Rail cũ mà trang này
    chưa có: badge trạng thái đã nói robot đang BUSY, nhưng không nói nó đang
    làm gì và tới đâu. Chỉ hiện khi thật sự có episode — không có run thì khối
    biến mất hẳn. Dữ liệu đến từ SSE, trang không tự fetch (§12.4). */
function ActiveRunPanel() {
  const episode = useRealtimeStore((s) => s.episodeProgress);
  const sessionId = useRealtimeStore((s) => s.sessionId);
  const agentStatus = useRealtimeStore((s) => s.agentStatus);
  if (!episode) return null;

  const percent = Math.round((episode.step / Math.max(episode.max_steps, 1)) * 100);

  return (
    <div className="border-t border-[var(--line)] pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="eyebrow flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse-dot" aria-hidden="true" />
          Đang thực thi
        </span>
        {agentStatus && <span className="text-[12.5px] text-haze-300">{agentStatus}</span>}
      </div>

      {episode.instruction && (
        <p className="text-[12.5px] text-paper-50 truncate">&ldquo;{episode.instruction}&rdquo;</p>
      )}

      <div
        className="h-1.5 rounded-full bg-ink-700 overflow-hidden"
        role="progressbar"
        aria-valuenow={episode.step}
        aria-valuemin={0}
        aria-valuemax={episode.max_steps}
        aria-label="Tiến độ thực thi"
      >
        <div
          className="h-full rounded-full bg-arc-500 transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="data text-[11.5px] text-haze-500">
          bước {episode.step}/{episode.max_steps} ({percent}%) · {episode.duration_s}s
        </span>
        {sessionId && (
          <Link href={`/control/${sessionId}`} className="btn-ghost !h-7 !px-2 !text-[12px] focus-ring">
            Mở phiên điều khiển
          </Link>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pose */

/** Pose đầu công tác — `xpos`/`xquat` trong MuJoCo. Chỉ render khi backend
    thật sự trả về; thiếu thì ẩn hẳn khối chứ không hiện N/A (§13.3). */
function EndEffectorPanel({ robot }: { robot: Robot }) {
  const ee = robot.end_effector;
  if (!ee) return null;

  const cells: { label: string; value: string }[] = [
    { label: "X", value: `${ee.position.x.toFixed(3)} m` },
    { label: "Y", value: `${ee.position.y.toFixed(3)} m` },
    { label: "Z", value: `${ee.position.z.toFixed(3)} m` },
    { label: "Roll", value: `${ee.orientation.roll.toFixed(1)}°` },
    { label: "Pitch", value: `${ee.orientation.pitch.toFixed(1)}°` },
    { label: "Yaw", value: `${ee.orientation.yaw.toFixed(1)}°` },
  ];

  return (
    <div className="border-t border-[var(--line)] pt-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <h3 className="eyebrow">Đầu công tác</h3>
        {robot.sim_time !== undefined && (
          <span className="data text-[11px] text-haze-500">t = {robot.sim_time.toFixed(2)}s</span>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {cells.map((cell) => (
          <div key={cell.label} className="panel-inset px-2.5 py-2">
            <span className="eyebrow block">{cell.label}</span>
            <span className="data text-[12px] whitespace-nowrap">{cell.value}</span>
          </div>
        ))}
      </div>

      {ee.gripper !== undefined && (
        <div className="flex items-center gap-2 mt-2">
          <span className="eyebrow shrink-0">Độ mở kẹp</span>
          <span className="data text-[12px]">{Math.round(ee.gripper * 100)}%</span>
          <div className="flex-1 h-1 bg-ink-700 rounded-full overflow-hidden max-w-[200px]">
            <div className="h-full rounded-full bg-arc-400" style={{ width: `${ee.gripper * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- robot */

function RobotStatusPanel({ robot }: { robot: Robot }) {
  const router = useRouter();
  const { robot_status, connection_status } = robot;

  const control = actionAvailability("sendMessage", robot_status, connection_status);
  const goHome = actionAvailability("goHome", robot_status, connection_status);
  const resetError = actionAvailability("resetError", robot_status, connection_status);
  const halt = actionAvailability("halt", robot_status, connection_status);

  return (
    <section className={`panel overflow-hidden ${connection_status === "OFFLINE" ? "opacity-60" : ""}`}>
      {/* Lỗi an toàn nằm trên cùng, không phải cuối trang */}
      {robot.health.has_error && (
        <div className="bg-halt-500/12 border-b border-halt-500/30 px-4 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-halt-500">Robot đang báo lỗi:</span>
          {robot.health.error_flags.map((flag) => (
            <span key={flag} className="data text-[11px] px-2 py-0.5 rounded bg-halt-500/15 text-halt-500">
              {flag}
            </span>
          ))}
        </div>
      )}

      <div className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="title truncate">{robot.name}</h2>
              <RobotStatusBadge robotStatus={robot_status} connectionStatus={connection_status} />
            </div>
            <p className="eyebrow mt-1.5 flex flex-wrap gap-2">
              <span>{robot.model}</span>
              <span aria-hidden="true">·</span>
              <span>edge {robot.edge_version}</span>
              <span aria-hidden="true">·</span>
              <span>{robot.joints.length} khớp</span>
            </p>
          </div>

          {/* Ưu tiên số 1 của §2.1: nút Dừng không bao giờ bị đẩy khỏi màn hình.
              Trang này giờ là trang của robot nên nó phải có mặt ở đây. */}
          <HaltButton robotId={robot.id} visible={halt.state === "enabled"} />
        </div>


        {/* Trạng thái từng khớp — phần "trạng thái robot" thật sự của trang */}
        <ActiveRunPanel />

        {/* Đồ thị Telemetry thời gian thực thay cho bảng trạng thái */}
        <TelemetryChart robot={robot} />

        <EndEffectorPanel robot={robot} />

        <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
          <DisabledHint reason={control.state === "disabled" ? control.reason : undefined}>
            <button
              type="button"
              onClick={() => router.push(`/control/new?robot_id=${robot.id}`)}
              disabled={control.state !== "enabled"}
              title={control.state === "enabled" ? "Mở phiên điều khiển" : undefined}
              className="btn-primary focus-ring"
            >
              Điều khiển
            </button>
          </DisabledHint>

          {goHome.state !== "hidden" && (
            <DisabledHint reason={goHome.state === "disabled" ? goHome.reason : undefined}>
              <button
                type="button"
                disabled={goHome.state !== "enabled"}
                title={goHome.state === "enabled" ? "Đưa robot về vị trí home" : undefined}
                className="btn-ghost border border-[var(--line)] focus-ring"
              >
                Về vị trí home
              </button>
            </DisabledHint>
          )}

          {resetError.state !== "hidden" && (
            <DisabledHint reason={resetError.state === "disabled" ? resetError.reason : undefined}>
              <button
                type="button"
                disabled={resetError.state !== "enabled"}
                title={resetError.state === "enabled" ? "Xoá cờ lỗi hiện tại" : undefined}
                className="btn-danger border border-halt-500/30 focus-ring"
              >
                Xoá lỗi
              </button>
            </DisabledHint>
          )}

          <Link href={`/robots/${robot.id}`} className="btn-ghost focus-ring ml-auto">
            Xem chi tiết
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- lists */

function RecentRuns({ runs }: { runs: Run[] }) {
  const router = useRouter();
  return (
    <section className="panel p-4">
      {runs.length === 0 ? (
        <p className="text-[13px] text-haze-500 py-4">Chưa có lượt chạy nào.</p>
      ) : (
        <div className="flex flex-col">
          {runs.slice(0, 5).map((run) => (
            <button
              key={run.id}
              type="button"
              onClick={() => router.push(`/runs/${run.id}`)}
              className="flex items-center gap-3 h-12 px-3 rounded-lg hover:bg-ink-700 transition-colors duration-[120ms] text-left focus-ring cursor-pointer"
            >
              <StatusBadge kind="source" value={run.source} />
              <span className="flex-1 text-[13px] text-paper-50 truncate">{run.input_text}</span>
              <span className="data text-[11.5px] text-haze-500 shrink-0">{formatDuration(run.duration_s)}</span>
              <StatusBadge kind="run" value={run.status} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function UpcomingSchedules({ schedules }: { schedules: Schedule[] }) {
  const upcoming = schedules.filter((s) => s.enabled).slice(0, 5);
  return (
    <section className="panel p-4">
      {upcoming.length === 0 ? (
        <p className="text-[13px] text-haze-500 py-4">Chưa có lịch nào đang bật.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {upcoming.map((schedule) => (
            <Link
              key={schedule.id}
              href={`/schedules/${schedule.id}`}
              className="px-3 py-2 rounded-lg hover:bg-ink-700 transition-colors duration-[120ms] focus-ring"
            >
              <p className="text-[13px] text-paper-50 font-medium truncate">{schedule.name}</p>
              {/* Câu tiếng Việt, không bao giờ là chuỗi cron thô (P07) */}
              <p className="text-[12px] text-haze-500 mt-0.5">{schedule.cron_description}</p>
              {schedule.next_run_at && (
                <p className="data text-[11.5px] text-haze-500 mt-1" title={formatAbsolute(schedule.next_run_at)}>
                  Lần tới: {formatRelative(schedule.next_run_at)}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- page */

export default function DashboardPage() {

  const [robot, setRobot] = useState<Robot | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [stats, setStats] = useState<RobotStats | null>(null);
  const [robotState, setRobotState] = useState<"loading" | "ready" | "error">("loading");
  const [robotError, setRobotError] = useState<ErrorObject | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Trạng thái đến từ SSE (nút Dừng, run đang chạy) phải thắng bản vừa poll về,
  // nếu không badge sẽ nhảy ngược mỗi 15 giây.
  const liveState = useRealtimeStore((s) => s.robotState);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchRobots()
        .then((data) => {
          if (cancelled) return;
          setRobot(data[0] ?? null);
          setRobotState("ready");
        })
        .catch((err) => {
          if (cancelled) return;
          setRobotError(toErrorObject(err));
          setRobotState("error");
        });
    };

    load();
    const interval = setInterval(load, ROBOT_REFETCH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;
    fetchRuns()
      .then((data) => !cancelled && setRuns(data))
      .catch(() => undefined);
    fetchSchedules()
      .then((data) => !cancelled && setSchedules(data))
      .catch(() => undefined);
    /* Thống kê bám theo robot ĐANG chọn, không phải một hằng số: trang này nói
       về con robot người dùng đang xem. */
    fetchRobotStats(robot?.id || PRIMARY_ROBOT_ID)
      .then((data) => !cancelled && setStats(data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [robot?.id]);

  const retryRobot = useCallback(() => {
    setRobotState("loading");
    setRobotError(null);
    setAttempt((a) => a + 1);
  }, []);

  const merged: Robot | null = robot
    ? {
        ...robot,
        robot_status: liveState?.robot_status ?? robot.robot_status,
        connection_status: liveState?.connection_status ?? robot.connection_status,
        joints: liveState?.joints ?? robot.joints,
      }
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-[1440px] mx-auto space-y-4">
      <h1 className="display-l text-paper-50">Tổng quan</h1>

      {robotState === "loading" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="panel p-4 h-[88px] flex flex-col justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="h-3 w-56" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
        </>
      )}

      {robotState === "error" && robotError && <ErrorPanel error={robotError} onRetry={retryRobot} />}

      {/* Thứ tự: thống kê → sắp tới → trạng thái hiện tại. Mở trang là thấy
          ngay bức tranh tổng, rồi mới tới chi tiết cỗ máy. */}
      {stats && (
        <>
          {/* Câu tóm tắt chỉ nói tỉ lệ khi CÓ lượt kết thúc — `success_rate`
              là `null` lúc chưa có, và làm tròn `null` sẽ ra "0% thành công",
              tức là báo hỏng trong khi thật ra chưa xong cái nào. */}
          <SectionHeading
            title="Thống kê"
            meta={
              stats.success_rate === null
                ? `${stats.total_runs} lượt trong ${stats.window_days} ngày`
                : `${stats.total_runs} lượt · ${Math.round(stats.success_rate * 100)}% thành công trong ${stats.window_days} ngày`
            }
          />
          <StatsPanel stats={stats} />
        </>
      )}

      <SectionHeading title="Sắp tới" meta={`${schedules.filter((s) => s.enabled).length} lịch đang bật`} />
      <UpcomingSchedules schedules={schedules} />

      {robotState === "ready" &&
        (merged === null ? (
          <EmptyState message="Chưa ghép nối robot nào. Chạy lệnh ghép nối trên thiết bị Edge để kết nối cánh tay." />
        ) : (
          <>
            <SectionHeading
              title="Trạng thái robot"
              meta={merged.connection_status === "ONLINE" ? `Trực tuyến · edge ${merged.edge_version}` : "Ngoại tuyến"}
            />
            <RobotStatusPanel robot={merged} />
          </>
        ))}

      <SectionHeading title="Chạy gần đây" />
      <RecentRuns runs={runs} />
    </div>
  );
}
