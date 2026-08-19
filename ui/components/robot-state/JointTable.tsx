"use client";
/* JointTable — P04 §4 (`get_robot_state`) và P10

   Bày đúng bộ đại lượng MuJoCo phơi ra cho mỗi khớp của cánh tay:

     qpos  góc hiện tại        ctrl   góc lệnh đặt
     Δ     sai số bám          qvel   vận tốc góc
     τ     mô-men khớp         range  dải giới hạn

   Cột Δ (ctrl − qpos) là cột đáng nhìn nhất: nó nói bộ điều khiển có bám kịp
   quỹ đạo không. Lệch lớn nghĩa là khớp đang vướng, quá tải, hoặc gain sai.

   Cánh tay không có cảm biến nhiệt nên không có cột nhiệt độ. Cột mô-men tô
   màu theo tỉ lệ với `forcerange` của chính khớp đó — vượt 85% chuyển đỏ, đó là
   dấu hiệu khớp bị ép quá. Cột nào backend không trả thì không dựng, không hiện
   N/A (§13.3). Mọi con số dùng .data + tabular-nums để chữ số không nhảy ngang
   khi cập nhật. */

import type { JointState } from "@/stores";
import { torqueTone, torqueRatio, TONE_TEXT_CLASS } from "@/lib/robot-actions";

export const JOINT_LABELS: Record<string, string> = {
  shoulder_pan: "Xoay vai",
  shoulder_lift: "Nâng vai",
  elbow: "Khuỷu",
  wrist_1: "Cổ tay 1",
  wrist_2: "Cổ tay 2",
  wrist_3: "Cổ tay 3",
};

export function jointLabel(name: string) {
  return JOINT_LABELS[name] ?? name;
}

/** Ngưỡng sai số bám coi là đáng chú ý, độ. */
const TRACKING_WARN = 2;
const TRACKING_BAD = 5;

/** Thanh cho thấy khớp đang đứng ở đâu trong dải cho phép của nó. */
function RangeBar({ joint }: { joint: JointState }) {
  const min = joint.range_min ?? -180;
  const max = joint.range_max ?? 180;
  const span = max - min || 1;
  const pos = ((joint.present_position - min) / span) * 100;
  const target =
    joint.target_position === undefined ? null : ((joint.target_position - min) / span) * 100;

  // Sát mép dải là dấu hiệu sắp chạm giới hạn khớp.
  const nearLimit = pos < 6 || pos > 94;

  return (
    <span className="relative flex items-center w-full h-2.5 min-w-[72px]" title={`${min}° … ${max}°`}>
      <span className="absolute inset-x-0 h-1 rounded-full bg-ink-700" />
      {target !== null && (
        <span
          className="absolute w-0.5 h-2.5 rounded-full bg-haze-500"
          style={{ left: `${Math.min(Math.max(target, 0), 100)}%` }}
          aria-hidden="true"
        />
      )}
      <span
        className={`absolute w-2 h-2 rounded-full ${nearLimit ? "bg-amber-400" : "bg-arc-400"}`}
        style={{ left: `calc(${Math.min(Math.max(pos, 0), 100)}% - 4px)` }}
        aria-hidden="true"
      />
    </span>
  );
}

interface JointTableProps {
  joints: JointState[];
  /** P10 và Tổng quan bày đủ; card trong chat giữ gọn. */
  detailed?: boolean;
}

export function JointTable({ joints, detailed = false }: JointTableProps) {
  // Chỉ dựng cột khi có dữ liệu thật cho cột đó.
  const hasVelocity = joints.some((j) => j.present_velocity !== undefined);
  const hasTarget = joints.some((j) => j.target_position !== undefined);
  const hasTorque = joints.some((j) => j.torque_nm !== undefined);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr>
            <th className="eyebrow pb-2 pr-3 font-medium">Khớp</th>
            <th className="eyebrow pb-2 pr-3 font-medium" title="qpos — góc hiện tại">Góc</th>
            {detailed && <th className="eyebrow pb-2 pr-3 font-medium w-[22%]">Dải cho phép</th>}
            {hasTarget && (
              <th className="eyebrow pb-2 pr-3 font-medium" title="ctrl − qpos — sai số bám quỹ đạo">
                Δ bám
              </th>
            )}
            {hasVelocity && detailed && (
              <th className="eyebrow pb-2 pr-3 font-medium" title="qvel — vận tốc góc">Vận tốc</th>
            )}
            {hasTorque && (
              <th className="eyebrow pb-2 pr-3 font-medium" title="Mô-men khớp, tô màu theo tỉ lệ với forcerange">
                Mô-men
              </th>
            )}
            {detailed && <th className="eyebrow pb-2 pr-3 font-medium">Torque</th>}
            <th className="eyebrow pb-2 font-medium">Cờ lỗi</th>
          </tr>
        </thead>
        <tbody>
          {joints.map((joint) => {
            const delta =
              joint.target_position === undefined
                ? null
                : joint.target_position - joint.present_position;
            const deltaTone =
              delta === null
                ? ""
                : Math.abs(delta) >= TRACKING_BAD
                  ? "text-halt-500"
                  : Math.abs(delta) >= TRACKING_WARN
                    ? "text-amber-400"
                    : "text-haze-500";

            return (
              <tr key={joint.name} className="border-t border-[var(--line)]">
                <td className="py-1.5 pr-3 text-[12px] text-haze-300 whitespace-nowrap">
                  {jointLabel(joint.name)}
                </td>
                <td className="py-1.5 pr-3 data text-[11.5px] whitespace-nowrap">
                  {joint.present_position.toFixed(1)}°
                </td>
                {detailed && (
                  <td className="py-1.5 pr-3">
                    <RangeBar joint={joint} />
                  </td>
                )}
                {hasTarget && (
                  <td className={`py-1.5 pr-3 data text-[11.5px] whitespace-nowrap ${deltaTone}`}>
                    {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}°`}
                  </td>
                )}
                {hasVelocity && detailed && (
                  <td className="py-1.5 pr-3 data text-[11.5px] whitespace-nowrap">
                    {joint.present_velocity === undefined ? "—" : `${joint.present_velocity.toFixed(1)}°/s`}
                  </td>
                )}
                {hasTorque && (
                  <td
                    className={`py-1.5 pr-3 data text-[11.5px] whitespace-nowrap ${
                      TONE_TEXT_CLASS[torqueTone(joint.torque_nm ?? 0, joint.torque_limit_nm)]
                    }`}
                    title={
                      joint.torque_limit_nm
                        ? `${Math.round((torqueRatio(joint) ?? 0) * 100)}% của forcerange ${joint.torque_limit_nm} N·m`
                        : undefined
                    }
                  >
                    {joint.torque_nm === undefined ? "—" : `${joint.torque_nm.toFixed(2)} N·m`}
                  </td>
                )}
                {detailed && (
                  <td className="py-1.5 pr-3 text-[11.5px]">
                    <span className={joint.torque_enabled ? "text-jade-400" : "text-haze-500"}>
                      {joint.torque_enabled ? "Bật" : "Tắt"}
                    </span>
                  </td>
                )}
                <td className="py-1.5">
                  {joint.error_flags.length === 0 ? (
                    <span className="text-[11.5px] text-haze-500">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {joint.error_flags.map((flag) => (
                        <span
                          key={flag}
                          className="data text-[10.5px] px-1.5 py-0.5 rounded bg-halt-500/12 text-halt-500"
                        >
                          {flag}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {detailed && (
        <p className="eyebrow mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <span>Chấm xanh = góc hiện tại</span>
          <span>Vạch xám = lệnh đặt</span>
          <span>Chấm hổ phách = sắp chạm giới hạn khớp</span>
        </p>
      )}
    </div>
  );
}
