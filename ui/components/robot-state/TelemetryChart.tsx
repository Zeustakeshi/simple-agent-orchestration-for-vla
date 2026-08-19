"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine
} from "recharts";
import type { Robot } from "@/stores";

const JOINT_COLORS: Record<string, string> = {
  shoulder_pan: "#A3E635", // lime
  shoulder_lift: "#D946EF", // fuchsia
  elbow: "#38BDF8", // sky
  wrist_1: "#FBBF24", // amber
  wrist_2: "#2DD4BF", // teal
  wrist_3: "#F87171", // red
};

/* Một điểm trên biểu đồ: `time` cộng hai chuỗi `obs_*` / `act_*` cho mỗi khớp,
   nên tên cột chỉ biết được lúc chạy. Chỉ mục chuỗi → số nói đúng chừng đó, và
   đủ để bỏ hết `any` mà không phải dựng type giả. */
type TelemetryPoint = Record<string, number>;

const WINDOW_POINTS = 50;
const TICK_MS = 500;

function pointAt(robot: Robot, timestamp: number, jitter: boolean): TelemetryPoint {
  const point: TelemetryPoint = { time: timestamp };
  robot.joints.forEach((j, idx) => {
    const wobble = jitter ? (Math.random() - 0.5) * 3 : 0;
    const offset = Math.sin((timestamp + idx * 1000) / 2000) * 15 + wobble;
    point[`obs_${j.name}`] = j.present_position + offset;
    point[`act_${j.name}`] =
      (j.target_position ?? j.present_position) + offset + (Math.random() - 0.5) * 5;
  });
  return point;
}

function seedHistory(robot: Robot): TelemetryPoint[] {
  const now = Date.now();
  return Array.from({ length: WINDOW_POINTS + 1 }, (_, i) =>
    pointAt(robot, now - (WINDOW_POINTS - i) * TICK_MS, false),
  );
}

function formatTime(tickItem: number): string {
  const d = new Date(tickItem);
  return `${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

/* Recharts không xuất sẵn kiểu payload nên khai báo đúng phần dùng tới. */
interface TooltipEntry {
  dataKey: string;
  color?: string;
  value: number;
}

/* Ở NGOÀI component. Định nghĩa bên trong thì mỗi lần render sinh ra một loại
   component mới, React tháo cây cũ dựng cây mới — tooltip mất state và nhấp
   nháy. Ở nhịp 500ms thì đó là 2 lần/giây. */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-ink-900/90 backdrop-blur border border-[var(--line-strong)] p-3 rounded-lg shadow-xl text-[12px] font-mono">
      {label !== undefined && <p className="text-haze-300 mb-2">{formatTime(label)}</p>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-paper-50 w-44 truncate">{p.dataKey.replace("obs_", "")}</span>
          <span className="text-right flex-1">{p.value.toFixed(2)}°</span>
        </div>
      ))}
    </div>
  );
}

interface TelemetryChartProps {
  robot: Robot;
}

export function TelemetryChart({ robot }: TelemetryChartProps) {
  /* Gieo dữ liệu ngay ở khởi tạo state, không phải trong effect: effect chạy
     sau khi vẽ nên biểu đồ hiện trống một khung hình rồi mới có đường — và
     `setData` đồng bộ trong effect đúng là thứ luật lint mới chặn.

     Gieo lại theo `robot.id` chứ không theo tham chiếu `robot`: app shell thăm
     dò robot mỗi 15s và luôn trả về object mới, nên bám tham chiếu thì cứ 15
     giây cửa sổ cuộn lại bị xoá sạch dựng lại. */
  const [data, setData] = useState<TelemetryPoint[]>(() => seedHistory(robot));
  const [lastRobotId, setLastRobotId] = useState(robot.id);
  if (robot.id !== lastRobotId) {
    setLastRobotId(robot.id);
    setData(seedHistory(robot));
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setData((prev) => {
        const next = [...prev, pointAt(robot, Date.now(), true)];
        if (next.length > WINDOW_POINTS) next.shift();
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [robot]);

  return (
    <div className="border-t border-[var(--line)] pt-4 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="eyebrow">Đồ thị Telemetry</h3>
        <span className="text-[12.5px] text-haze-500">
          Observation · Khớp 0-5
        </span>
      </div>

      <div className="flex flex-col bg-ink-950 p-2 rounded-xl border border-[var(--line)] shadow-inner">
        {/* Top Panel (Khớp 0-2) */}
        <div className="h-[200px] w-full border-b border-[var(--line)]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} syncId="telemetry" margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
              <XAxis dataKey="time" hide />
              <YAxis domain={['auto', 'auto']} tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke="#444" />
              {robot.joints.slice(0, 3).map((j) => (
                <Line
                  key={`obs_${j.name}`}
                  type="stepAfter"
                  dataKey={`obs_${j.name}`}
                  stroke={JOINT_COLORS[j.name]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "10px", color: "#888" }}
                formatter={(value: string) => {
                  return <span className="text-haze-300 font-mono">{value.replace("obs_", "")}</span>;
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Bottom Panel (Khớp 3-5) */}
        <div className="h-[240px] w-full pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} syncId="telemetry" margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={formatTime}
                tick={{ fill: "#666", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={30}
              />
              <YAxis domain={['auto', 'auto']} tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0} stroke="#444" />
              {robot.joints.slice(3, 6).map((j) => (
                <Line
                  key={`obs_${j.name}`}
                  type="stepAfter"
                  dataKey={`obs_${j.name}`}
                  stroke={JOINT_COLORS[j.name]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "10px", color: "#888" }}
                formatter={(value: string) => {
                  return <span className="text-haze-300 font-mono">{value.replace("obs_", "")}</span>;
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
