"use client";
/* RobotStatusBadge — MASTER §11.1
   Single source of truth for status badge rendering.
   No other component should replicate this logic. */

import { Circle, Loader, OctagonX, TriangleAlert, Unplug } from "lucide-react";
import type { RobotStatus, ConnectionStatus } from "@/stores";

interface RobotStatusBadgeProps {
  robotStatus: RobotStatus;
  connectionStatus: ConnectionStatus;
  size?: "sm" | "md";
}

const statusConfig: Record<
  RobotStatus | "OFFLINE",
  {
    label: string;
    bg: string;
    text: string;
    Icon: typeof Circle;
    effect?: string;
  }
> = {
  IDLE: {
    label: "Rảnh",
    bg: "bg-ink-700",
    text: "text-haze-300",
    Icon: Circle,
  },
  BUSY: {
    label: "Đang chạy",
    bg: "bg-arc-500/15",
    text: "text-arc-400",
    Icon: Loader,
    effect: "animate-pulse-dot",
  },
  STOPPING: {
    label: "Đang dừng",
    bg: "bg-amber-400/15",
    text: "text-amber-400",
    Icon: OctagonX,
  },
  ERROR: {
    label: "Lỗi",
    bg: "bg-halt-500/15",
    text: "text-halt-500",
    Icon: TriangleAlert,
  },
  DISCONNECTED: {
    label: "Mất kết nối",
    bg: "bg-ink-700",
    text: "text-haze-500",
    Icon: Unplug,
  },
  OFFLINE: {
    label: "Ngoại tuyến",
    bg: "bg-ink-700",
    text: "text-haze-500",
    Icon: Unplug,
  },
};

export function RobotStatusBadge({
  robotStatus,
  connectionStatus,
  size = "md",
}: RobotStatusBadgeProps) {
  // OFFLINE overrides display — §11.1
  const displayKey = connectionStatus === "OFFLINE" ? "OFFLINE" : robotStatus;
  const config = statusConfig[displayKey];
  const { label, bg, text, Icon, effect } = config;

  const sizeClasses = size === "sm"
    ? "h-5 px-2 text-[10px] gap-1"
    : "h-6 px-2.5 text-[11.5px] gap-1.5";

  return (
    <span
      className={`inline-flex items-center ${sizeClasses} rounded-full font-medium uppercase tracking-[0.06em] ${bg} ${text} ${
        displayKey === "DISCONNECTED" || displayKey === "OFFLINE" ? "line-through" : ""
      }`}
    >
      <span className={`relative flex items-center justify-center ${effect ?? ""}`}>
        <Icon size={size === "sm" ? 10 : 12} strokeWidth={2} />
      </span>
      {label}
    </span>
  );
}
