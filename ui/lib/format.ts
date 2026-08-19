/* Formatting — MASTER §20
   Dates follow the user's timezone; relative strings always carry an absolute
   `title`. Numbers use vi-VN. Nothing here invents a value it wasn't given. */

import { useAuthStore } from "@/stores";

function timezone(): string | undefined {
  return useAuthStore.getState().user?.timezone;
}

export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("vi-VN", { timeZone: timezone() });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("vi-VN", {
    timeZone: timezone(),
    hour: "2-digit",
    minute: "2-digit",
  });
}

const UNITS: [limitSeconds: number, divisor: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, "second"],
  [3600, 60, "minute"],
  [86_400, 3600, "hour"],
  [604_800, 86_400, "day"],
  [2_629_800, 604_800, "week"],
  [31_557_600, 2_629_800, "month"],
  [Infinity, 31_557_600, "year"],
];

/** "2 phút trước" / "trong 3 giờ". Pair with `title={formatAbsolute(iso)}`. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const deltaSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const magnitude = Math.abs(deltaSeconds);
  const [, divisor, unit] = UNITS.find(([limit]) => magnitude < limit) ?? UNITS[UNITS.length - 1];
  const formatter = new Intl.RelativeTimeFormat("vi-VN", { numeric: "auto" });
  return formatter.format(Math.round(deltaSeconds / divisor), unit);
}

/** Seconds → "45s" / "12 phút 5s". Returns "—" when the backend sent nothing. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes} phút ${rest}s` : `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return `${hours} giờ ${minutes % 60} phút`;
}

/** Mili-giây → `"480ms"` / `"1.1s"` / `"24s"` / `"1 phút 5s"`.
 *
 *  Khác `formatDuration` ở trên: hàm kia nhận GIÂY và trả `"—"` khi rỗng. Ở đây
 *  trả về CHUỖI RỖNG, để chỗ gọi ẩn hẳn phần tử thay vì hiện một dấu gạch —
 *  §13.3: thiếu trường thì ẩn, không hiện chỗ trống.
 *
 *  Dưới 10 giây giữ một chữ số thập phân vì phần lớn thao tác của agent nằm
 *  trong khoảng đó, làm tròn hết thì mọi bước trông như nhau. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return formatDuration(seconds);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("vi-VN").format(value);
}
