"use client";
/* CronBuilder — P07 ⭐
   MỘT chế độ: ô tần suất cùng các điều khiển mà tần suất đó cần, và biểu thức
   cron sinh ra hiện nhỏ bên dưới ở dạng CHỈ ĐỌC cho người quen đọc cron.

   Không còn chế độ "Nâng cao" gõ cron tay: đó là chỗ dễ sai nhất trong form, và
   lịch sai giờ với robot nghĩa là cánh tay cử động lúc không ai trông. Ai thật
   sự cần biểu thức lạ thì đó là dấu hiệu cần thêm một tần suất mới ở đây.

   Biểu thức được debounce 500ms rồi gửi lên server kiểm tra. Client KHÔNG tự
   cài lại luật cron (P07): nó chỉ hiện những gì server trả về, gồm cả năm lần
   chạy kế tiếp theo giờ địa phương. */

import { useState, useEffect } from "react";
import { validateCron, type CronValidation } from "@/lib/api/schedules";

const VALIDATE_DEBOUNCE_MS = 500;

type Frequency = "hourly" | "daily" | "weekly" | "monthly";

const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: "hourly", label: "Hàng giờ" },
  { key: "daily", label: "Hàng ngày" },
  { key: "weekly", label: "Hàng tuần" },
  { key: "monthly", label: "Ngày trong tháng" },
];

const WEEKDAY_CHIPS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

interface CronBuilderProps {
  value: string;
  onChange: (expression: string) => void;
  /** Bubbles the server's description up so the parent can save it. */
  onValidation?: (result: CronValidation) => void;
  timezone: string;
}

export function CronBuilder({ value, onChange, onValidation, timezone }: CronBuilderProps) {
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [hour, setHour] = useState(8);
  const [minute, setMinute] = useState(0);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [validation, setValidation] = useState<CronValidation | null>(null);
  const [validating, setValidating] = useState(false);

  /* Biểu thức được ghép từ chính các điều khiển. Ghép trong handler chứ không
     trong effect, nên không có vòng render → effect → render. */
  type VisualState = {
    frequency: Frequency;
    hour: number;
    minute: number;
    weekdays: number[];
    dayOfMonth: number;
  };

  const current: VisualState = { frequency, hour, minute, weekdays, dayOfMonth };

  const compose = (next: VisualState): string => {
    switch (next.frequency) {
      case "hourly":
        return `${next.minute} * * * *`;
      case "weekly":
        return `${next.minute} ${next.hour} * * ${next.weekdays.length ? [...next.weekdays].sort((a, b) => a - b).join(",") : "*"}`;
      case "monthly":
        return `${next.minute} ${next.hour} ${next.dayOfMonth} * *`;
      default:
        return `${next.minute} ${next.hour} * * *`;
    }
  };

  const applyVisual = (patch: Partial<VisualState>) => {
    const next = { ...current, ...patch };
    if (patch.frequency !== undefined) setFrequency(patch.frequency);
    if (patch.hour !== undefined) setHour(patch.hour);
    if (patch.minute !== undefined) setMinute(patch.minute);
    if (patch.weekdays !== undefined) setWeekdays(patch.weekdays);
    if (patch.dayOfMonth !== undefined) setDayOfMonth(patch.dayOfMonth);
    onChange(compose(next));
  };

  // Debounced server validation — the client never decides validity itself.
  useEffect(() => {
    if (!value.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setValidating(true);
      validateCron(value, timezone)
        .then((result) => {
          if (cancelled) return;
          setValidation(result);
          onValidation?.(result);
        })
        .finally(() => {
          if (!cancelled) setValidating(false);
        });
    }, VALIDATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, timezone, onValidation]);

  const toggleWeekday = (day: number) =>
    applyVisual({
      weekdays: weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day],
    });

  return (
    <div className="space-y-3">
      <div className="panel-inset p-4 space-y-3">
        <label className="flex items-center gap-3 flex-wrap">
          <span className="text-[13px] text-haze-300 w-20">Tần suất</span>
          <select
            value={frequency}
            onChange={(e) => applyVisual({ frequency: e.target.value as Frequency })}
            className="h-9 px-3 rounded-lg bg-ink-800 border border-[var(--line)] text-[13px] text-paper-50 focus:outline-none focus-ring cursor-pointer"
          >
            {FREQUENCIES.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        {frequency !== "hourly" && (
          <label className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] text-haze-300 w-20">Giờ chạy</span>
            <span className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => applyVisual({ hour: Math.min(23, Math.max(0, Number(e.target.value))) })}
                aria-label="Giờ"
                className="w-16 h-9 px-2 rounded-lg bg-ink-800 border border-[var(--line)] data text-paper-50 text-center focus:outline-none focus-ring"
              />
              <span className="text-haze-500">:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={(e) => applyVisual({ minute: Math.min(59, Math.max(0, Number(e.target.value))) })}
                aria-label="Phút"
                className="w-16 h-9 px-2 rounded-lg bg-ink-800 border border-[var(--line)] data text-paper-50 text-center focus:outline-none focus-ring"
              />
            </span>
          </label>
        )}

        {frequency === "hourly" && (
          <label className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] text-haze-300 w-20">Phút thứ</span>
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(e) => applyVisual({ minute: Math.min(59, Math.max(0, Number(e.target.value))) })}
              aria-label="Phút trong giờ"
              className="w-16 h-9 px-2 rounded-lg bg-ink-800 border border-[var(--line)] data text-paper-50 text-center focus:outline-none focus-ring"
            />
          </label>
        )}

        {frequency === "weekly" && (
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-[13px] text-haze-300 w-20 pt-1.5">Ngày</span>
            <div className="flex gap-1.5 flex-wrap">
              {WEEKDAY_CHIPS.map((chip) => {
                const on = weekdays.includes(chip.value);
                return (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => toggleWeekday(chip.value)}
                    aria-pressed={on}
                    className={`h-8 w-10 rounded-lg text-[12.5px] font-medium border transition-colors duration-[120ms] focus-ring cursor-pointer ${
                      on
                        ? "bg-arc-500/15 text-arc-400 border-arc-500/40"
                        : "bg-ink-800 text-haze-500 border-[var(--line)] hover:text-paper-50"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {frequency === "monthly" && (
          <label className="flex items-center gap-3 flex-wrap">
            <span className="text-[13px] text-haze-300 w-20">Ngày</span>
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => applyVisual({ dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value))) })}
              aria-label="Ngày trong tháng"
              className="w-16 h-9 px-2 rounded-lg bg-ink-800 border border-[var(--line)] data text-paper-50 text-center focus:outline-none focus-ring"
            />
          </label>
        )}

      {/* Biểu thức cron vẫn hiện, chỉ ĐỌC. Người quen đọc cron kiểm tra
        được ngay các ô phía trên sinh ra cái gì; người không quen thì bỏ
        qua. Trước đây ô này sửa được ở chế độ "Nâng cao" — bỏ chế độ đó vì
        một biểu thức cron gõ tay là chỗ dễ sai nhất trong cả form, mà lịch
        sai giờ với robot nghĩa là cánh tay cử động lúc không ai trông. */}
      <p className="font-mono text-[12px] text-haze-500 pt-1">{value}</p>
      </div>

      {/* Server verdict — never a client-side guess */}
      <div aria-live="polite">
        {validating && <p className="text-[12.5px] text-haze-500">Đang kiểm tra lịch…</p>}

        {!validating && validation?.valid && (
          <div className="panel-inset p-3">
            <p className="text-[13px] text-jade-400 mb-2">{validation.cron_description}</p>
            <p className="eyebrow mb-1">5 lần chạy tiếp theo</p>
            <ul className="space-y-0.5">
              {validation.next_5_runs_local?.map((run) => (
                <li key={run} className="data text-[11.5px] text-haze-300">
                  {run}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!validating && validation && !validation.valid && (
          <p className="text-[12.5px] text-halt-500">{validation.message}</p>
        )}
      </div>
    </div>
  );
}
