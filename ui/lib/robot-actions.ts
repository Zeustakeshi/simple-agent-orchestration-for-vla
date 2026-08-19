/* Action lock matrix — MASTER §11.2
   Single source of truth for "is this button enabled, and if not, why?"
   Every disabled button must show the reason (§11.2 tooltip rule). */

import type { RobotStatus, ConnectionStatus } from "@/stores";

export type RobotAction =
  | "sendMessage"
  | "halt"
  | "goHome"
  | "resetError"
  | "runScheduleNow"
  | "viewCamera"
  /* Giữ trong ma trận cho khớp bảng §11.2, dù giao diện hiện không dựng nút
     nào cho nó — luồng ghép nối đã bỏ, nên gỡ robot là cửa một chiều. */
  | "unpairRobot";

/** `hidden` = not rendered at all · `enabled` = clickable · `disabled` = greyed with reason */
export type ActionAvailability =
  | { state: "hidden" }
  | { state: "enabled" }
  | { state: "disabled"; reason: string };

/** The effective axis used by the matrix: OFFLINE connection overrides robot_status. */
export type EffectiveState = RobotStatus | "OFFLINE";

export function effectiveState(
  robotStatus: RobotStatus,
  connectionStatus: ConnectionStatus,
): EffectiveState {
  return connectionStatus === "OFFLINE" ? "OFFLINE" : robotStatus;
}

const REASON: Record<EffectiveState, string> = {
  IDLE: "",
  BUSY: "Robot đang thực hiện nhiệm vụ khác.",
  STOPPING: "Robot đang dừng, vui lòng chờ.",
  ERROR: "Robot đang lỗi. Xoá lỗi trước khi ra lệnh mới.",
  DISCONNECTED: "Robot đang mất kết nối.",
  OFFLINE: "Robot đang ngoại tuyến.",
};

/* Matrix straight from MASTER §11.2.
   "on" = enabled · "off" = disabled with reason · "hide" = not rendered */
type Cell = "on" | "off" | "hide";

const MATRIX: Record<RobotAction, Record<EffectiveState, Cell>> = {
  //                 IDLE    BUSY    STOPPING  ERROR   DISCONNECTED  OFFLINE
  sendMessage:     { IDLE: "on",  BUSY: "off",  STOPPING: "off",  ERROR: "off",  DISCONNECTED: "off", OFFLINE: "off" },
  halt:            { IDLE: "hide", BUSY: "on",  STOPPING: "on",   ERROR: "hide", DISCONNECTED: "on",  OFFLINE: "on" },
  goHome:          { IDLE: "on",  BUSY: "off",  STOPPING: "off",  ERROR: "off",  DISCONNECTED: "off", OFFLINE: "off" },
  resetError:      { IDLE: "hide", BUSY: "hide", STOPPING: "hide", ERROR: "on",  DISCONNECTED: "hide", OFFLINE: "off" },
  runScheduleNow:  { IDLE: "on",  BUSY: "off",  STOPPING: "off",  ERROR: "off",  DISCONNECTED: "off", OFFLINE: "off" },
  viewCamera:      { IDLE: "on",  BUSY: "on",   STOPPING: "on",   ERROR: "on",   DISCONNECTED: "off", OFFLINE: "off" },
  unpairRobot:     { IDLE: "on",  BUSY: "off",  STOPPING: "off",  ERROR: "on",   DISCONNECTED: "on",  OFFLINE: "on" },
};

export function actionAvailability(
  action: RobotAction,
  robotStatus: RobotStatus,
  connectionStatus: ConnectionStatus,
): ActionAvailability {
  const state = effectiveState(robotStatus, connectionStatus);
  const cell = MATRIX[action][state];
  if (cell === "hide") return { state: "hidden" };
  if (cell === "on") return { state: "enabled" };
  return { state: "disabled", reason: REASON[state] || "Thao tác không khả dụng lúc này." };
}

/** Composer placeholder — MASTER §11.3 */
export function composerPlaceholder(
  robotStatus: RobotStatus,
  connectionStatus: ConnectionStatus,
): string {
  const state = effectiveState(robotStatus, connectionStatus);
  switch (state) {
    case "IDLE":
      return "Ra lệnh cho robot…";
    case "BUSY":
    case "STOPPING":
      return "Robot đang thực hiện nhiệm vụ…";
    case "ERROR":
      return "Robot đang lỗi. Xoá lỗi trước khi ra lệnh mới.";
    default:
      return "Robot đang ngoại tuyến.";
  }
}

/* Mức gắng sức của một khớp = |mô-men| so với `forcerange` của actuator.
   Đây là thứ thay chỗ nhiệt độ: cánh tay không có cảm biến nhiệt, nhưng khớp
   bị ép quá sức thì luôn lộ ra ở mô-men. Ngưỡng đặt theo tỉ lệ vì mỗi khớp có
   một forcerange khác nhau — khớp vai và khớp cổ tay không thể chung một mốc
   N·m tuyệt đối. */
export function torqueTone(torqueNm: number, limitNm: number | undefined): "jade" | "amber" | "halt" {
  if (!limitNm) return "jade";
  const ratio = Math.abs(torqueNm) / limitNm;
  if (ratio > 0.85) return "halt";
  if (ratio >= 0.6) return "amber";
  return "jade";
}

/** Tỉ lệ gắng sức, 0…1. Thiếu giới hạn thì coi như không biết. */
export function torqueRatio(joint: { torque_nm?: number; torque_limit_nm?: number }): number | null {
  if (joint.torque_nm === undefined || !joint.torque_limit_nm) return null;
  return Math.min(Math.abs(joint.torque_nm) / joint.torque_limit_nm, 1);
}

export const TONE_TEXT_CLASS: Record<"jade" | "amber" | "halt", string> = {
  jade: "text-jade-400",
  amber: "text-amber-400",
  halt: "text-halt-500",
};

export const TONE_BG_CLASS: Record<"jade" | "amber" | "halt", string> = {
  jade: "bg-jade-400",
  amber: "bg-amber-400",
  halt: "bg-halt-500",
};
