"use client";
/* CommandPalette — P02 "⌘K"
   A temporary layer over the app, so .liquid-glass--strong is allowed here
   (whitelist slot 4, MASTER §9.1). Esc closes, focus is trapped, and
   "Dừng robot {tên}" is pinned to the top whenever the robot is BUSY. */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, MessageSquarePlus, MessagesSquare, CalendarClock, ScrollText, Settings2, OctagonX, Cpu, type LucideIcon } from "lucide-react";
import { useAuthStore, toast, type Robot, type Session, type Schedule, type Run } from "@/stores";
import { stopRobot } from "@/lib/api/robots";
import { fetchSessions } from "@/lib/api/sessions";
import { fetchSchedules } from "@/lib/api/schedules";
import { fetchRuns } from "@/lib/api/runs";
import { errorText, toErrorObject } from "@/lib/errors";

interface Command {
  id: string;
  label: string;
  hint?: string;
  Icon: LucideIcon;
  danger?: boolean;
  /** Nhãn nhóm hiện phía trên mục đầu tiên của nhóm đó. */
  group: string;
  run: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
  robots: Robot[];
}

export function CommandPalette({ onClose, robots }: CommandPaletteProps) {
  const router = useRouter();
  const selectRobot = useAuthStore((s) => s.selectRobot);
  const selectedRobotId = useAuthStore((s) => s.selectedRobotId);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  /* Nội dung để tìm — nạp đúng lúc mở palette, không nạp sẵn theo app. Palette
     chỉ sống khi đang mở nên effect này chạy một lần mỗi lần mở. */
  const [sessions, setSessions] = useState<Session[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchSessions().then((d) => !cancelled && setSessions(d)).catch(() => undefined);
    fetchSchedules().then((d) => !cancelled && setSchedules(d)).catch(() => undefined);
    fetchRuns().then((d) => !cancelled && setRuns(d)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const commands = useMemo<Command[]>(() => {
    const stopCommands: Command[] = robots
      .filter((robot) => robot.robot_status === "BUSY" || robot.robot_status === "STOPPING")
      .map((robot) => ({
        id: `stop-${robot.id}`,
        label: `Dừng robot ${robot.name}`,
        hint: "Dừng khẩn cấp",
        Icon: OctagonX,
        danger: true,
        group: "Hành động",
        run: () => {
          stopRobot(robot.id)
            .then(() => toast.success("Đã gửi lệnh dừng."))
            .catch((err) => toast.error(errorText(toErrorObject(err))));
        },
      }));

    const navigation: Command[] = [
      { id: "nav-dashboard", label: "Tổng quan", Icon: LayoutGrid, group: "Trang", run: () => router.push("/dashboard") },
      { id: "nav-sessions", label: "Trò chuyện", Icon: MessagesSquare, group: "Trang", run: () => router.push("/control/new") },
      { id: "nav-schedules", label: "Lịch chạy", Icon: CalendarClock, group: "Trang", run: () => router.push("/schedules") },
      { id: "nav-runs", label: "Nhật ký", Icon: ScrollText, group: "Trang", run: () => router.push("/runs") },
      { id: "nav-settings", label: "Cài đặt", Icon: Settings2, group: "Trang", run: () => router.push("/settings") },
    ];

    // Một robot thì không có gì để chọn — bỏ hẳn nhóm lệnh này thay vì bày một
    // mục bấm vào không đổi gì. Nhiều robot thì nó quay lại.
    const robotCommands: Command[] =
      robots.length > 1
        ? robots.map((robot) => ({
            id: `select-${robot.id}`,
            label: `Chọn robot ${robot.name}`,
            hint: robot.id === selectedRobotId ? "Đang chọn" : undefined,
            Icon: Cpu,
            group: "Robot",
            run: () => selectRobot(robot.id),
          }))
        : [];

    /* Hành động đứng trước nơi chốn: lệnh Dừng luôn đầu danh sách (P02), rồi
       tới tạo phiên mới, sau đó mới tới các trang. */
    const actionCommands: Command[] = [
      {
        id: "action-new-session",
        label: "Phiên mới",
        Icon: MessageSquarePlus,
        group: "Hành động",
        run: () => {
          const href = selectedRobotId
            ? `/control/new?new=1&robot_id=${encodeURIComponent(selectedRobotId)}`
            : "/control/new?new=1";
          router.push(href);
        },
      },
    ];

    return [...stopCommands, ...actionCommands, ...navigation, ...robotCommands];
  }, [robots, router, selectRobot, selectedRobotId]);

  /* Kết quả nội dung — chỉ dựng khi người dùng đã gõ. Không gõ gì thì palette
     vẫn là bảng lệnh gọn, không đổ cả trăm dòng phiên và nhật ký ra màn hình.

     Mỗi nhóm cắt 5 dòng: palette là chỗ nhảy nhanh, muốn duyệt đầy đủ thì đã có
     trang riêng với bộ lọc của nó. */
  const MAX_PER_GROUP = 5;

  const contentResults = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const has = (...fields: (string | null | undefined)[]) =>
      fields.some((f) => (f ?? "").toLowerCase().includes(q));

    const sessionHits: Command[] = sessions
      .filter((s) => has(s.title, s.last_message_preview))
      .slice(0, MAX_PER_GROUP)
      .map((s) => ({
        id: `session-${s.id}`,
        label: s.title,
        hint: s.last_message_preview ?? undefined,
        Icon: MessagesSquare,
        group: "Phiên",
        run: () => router.push(`/control/${s.id}`),
      }));

    const scheduleHits: Command[] = schedules
      .filter((s) => has(s.name, s.description, s.task_prompt))
      .slice(0, MAX_PER_GROUP)
      .map((s) => ({
        id: `schedule-${s.id}`,
        label: s.name,
        hint: s.cron_description,
        Icon: CalendarClock,
        group: "Lịch chạy",
        run: () => router.push(`/schedules/${s.id}`),
      }));

    const runHits: Command[] = runs
      .filter((r) => has(r.input_text, r.trace_id))
      .slice(0, MAX_PER_GROUP)
      .map((r) => ({
        id: `run-${r.id}`,
        label: r.input_text,
        hint: r.status,
        Icon: ScrollText,
        group: "Nhật ký",
        run: () => router.push(`/runs/${r.id}`),
      }));

    return [...sessionHits, ...scheduleHits, ...runHits];
  }, [query, sessions, schedules, runs, router]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return [...commands.filter((c) => c.label.toLowerCase().includes(q)), ...contentResults];
  }, [commands, contentResults, query]);

  // The parent mounts this only while open, so remembering the trigger and
  // handing focus back happens on mount/unmount — no state resets needed.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => triggerRef.current?.focus?.();
  }, []);

  const execute = useCallback(
    (command: Command) => {
      onClose();
      command.run();
    },
    [onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(filtered.length, 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1));
    }
    if (e.key === "Enter" && filtered[activeIndex]) {
      e.preventDefault();
      execute(filtered[activeIndex]);
    }
    if (e.key === "Tab") {
      // Nothing else is focusable — keep focus on the input.
      e.preventDefault();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] px-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Bảng lệnh"
        className="liquid-glass liquid-glass--strong relative rounded-xl w-[560px] max-w-full overflow-hidden"
      >
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          placeholder="Tìm phiên, lịch chạy, nhật ký — hoặc gõ lệnh…"
          aria-label="Tìm lệnh"
          className="w-full h-12 px-4 bg-transparent text-[14px] text-paper-50 placeholder:text-haze-500 focus:outline-none border-b border-[var(--line)]"
        />

        <ul role="listbox" aria-label="Kết quả" className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-[13px] text-haze-500">
              Không tìm thấy gì khớp với &ldquo;{query.trim()}&rdquo;.
            </li>
          ) : (
            filtered.map((command, i) => (
              <li key={command.id}>
                {/* Nhãn nhóm chỉ in ở mục ĐẦU của mỗi nhóm — kết quả trộn lệnh,
                    trang, phiên, lịch và nhật ký nên không có nhãn thì không
                    biết dòng mình chọn thuộc loại nào. */}
                {(i === 0 || filtered[i - 1].group !== command.group) && (
                  <p className="eyebrow px-4 pt-2 pb-1">{command.group}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => execute(command)}
                  className={`w-full flex items-center gap-2.5 px-4 h-10 text-[13px] text-left cursor-pointer ${
                    i === activeIndex ? "bg-[var(--overlay-hover)]" : ""
                  } ${command.danger ? "text-halt-500 font-medium" : "text-paper-50"}`}
                >
                  <command.Icon size={15} className="shrink-0" />
                  <span className="flex-1 truncate">{command.label}</span>
                  {command.hint && <span className="eyebrow shrink-0">{command.hint}</span>}
                </button>
              </li>
            ))
          )}
        </ul>

        <p className="px-4 py-2 border-t border-[var(--line)] text-[11.5px] text-haze-500">
          ↑↓ chọn · Enter chạy · Esc đóng
        </p>
      </div>
    </div>
  );
}
