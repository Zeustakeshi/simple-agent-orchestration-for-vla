"use client";
/* LogViewer — P09 §"Log Viewer"
 *
 * Chữ mono, KHÔNG kính (MASTER §9.2): đây là công cụ đọc hàng trăm dòng liên
 * tục, mọi thứ làm nhoè nét chữ đều phản tác dụng. Bề mặt dùng token nên tự
 * đảo đúng ở cả hai chế độ sáng/tối.
 *
 * Ba bộ lọc chồng nhau (level ∩ service ∩ tìm kiếm) vì log thật lẫn lộn nhiều
 * nguồn — không lọc được thì bảng này chỉ để nhìn cho có.
 */

import { useState, useMemo, useRef, useEffect, useDeferredValue } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";
import type { MockLogEntry } from "@/lib/mock/runs";
import { EmptyState } from "@/components/common/EmptyState";

type Level = MockLogEntry["level"];

const LEVELS: Level[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

/* §9.2 khoá màu theo ngữ nghĩa — không được đổi tuỳ hứng. */
const LEVEL_TEXT: Record<Level, string> = {
  DEBUG: "text-haze-500",
  INFO: "text-haze-300",
  WARN: "text-amber-400",
  ERROR: "text-halt-500",
  FATAL: "text-halt-500",
};

/** Dòng lỗi phải nhận ra được khi lướt nhanh, không chỉ khi đọc kỹ từng chữ. */
const LEVEL_ROW: Partial<Record<Level, string>> = {
  ERROR: "bg-halt-500/8",
  FATAL: "bg-halt-500/8",
};

/* Trần số dòng render cùng lúc (MASTER §16). Log thật dễ lên hàng nghìn dòng;
   dựng hết ra DOM thì cuộn giật và tab ngốn bộ nhớ. Cắt cửa sổ giữ phần MỚI
   NHẤT — đó là phần người ta thực sự đọc khi đang gỡ lỗi. */
const RENDER_LIMIT = 500;

/** Debounce ô tìm kiếm 300ms — gõ tới đâu lọc tới đó thì giật ở danh sách dài. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

function timeOf(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ------------------------------------------------------------------ chip */

function FilterChip({
  active,
  onClick,
  children,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-6 px-2 rounded-md text-[11px] font-mono transition-colors duration-[120ms] focus-ring cursor-pointer ${
        active ? "bg-ink-700 text-paper-50" : "text-haze-500 hover:text-haze-300 hover:bg-ink-800"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- row */

function LogRow({
  entry,
  showTrace,
}: {
  entry: MockLogEntry;
  /** Chỉ hiện nút copy khi trace_id KHÁC của run — trùng thì là nhiễu. */
  showTrace: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasAttrs = Boolean(entry.attrs && Object.keys(entry.attrs).length > 0);

  const copyTrace = async () => {
    if (!entry.trace_id) return;
    await navigator.clipboard.writeText(entry.trace_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className={LEVEL_ROW[entry.level] ?? ""}>
      <div className="flex items-start gap-2 px-3 py-1 leading-[1.6]">
        {/* Chỉ dòng CÓ attrs mới bấm mở được — dòng không có mà vẫn bấm được
            thì người dùng bấm rồi không thấy gì, tưởng hỏng. */}
        {hasAttrs ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Thu gọn chi tiết" : "Xem chi tiết"}
            className="shrink-0 mt-[3px] text-haze-500 hover:text-paper-50 focus-ring rounded cursor-pointer"
          >
            <ChevronDown size={11} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
        ) : (
          <span className="shrink-0 w-[11px]" aria-hidden="true" />
        )}

        <time dateTime={entry.timestamp} className="shrink-0 text-haze-500 tabular-nums">
          {timeOf(entry.timestamp)}
        </time>
        <span className={`shrink-0 w-11 ${LEVEL_TEXT[entry.level]}`}>{entry.level}</span>
        <span className="shrink-0 text-cyan-400">{entry.service}</span>
        <span className="shrink-0 text-haze-500">{entry.event}</span>
        <span className={`min-w-0 break-words ${entry.level === "DEBUG" ? "text-haze-300" : "text-paper-50"}`}>
          {entry.message}
        </span>

        {showTrace && entry.trace_id && (
          <button
            type="button"
            onClick={copyTrace}
            title={`Chép trace_id ${entry.trace_id}`}
            aria-label={`Chép trace_id ${entry.trace_id}`}
            className="ml-auto shrink-0 inline-flex items-center gap-1 text-haze-500 hover:text-paper-50 focus-ring rounded cursor-pointer"
          >
            {copied ? <Check size={11} className="text-jade-400" /> : <Copy size={11} />}
            <span className="text-[10.5px]">{entry.trace_id}</span>
          </button>
        )}
      </div>

      {open && hasAttrs && (
        <pre className="panel-inset ml-6 mr-3 mb-2 px-3 py-2 text-[11.5px] text-haze-300 overflow-x-auto whitespace-pre">
          {JSON.stringify(entry.attrs, null, 2)}
        </pre>
      )}
    </li>
  );
}

/* ----------------------------------------------------------------- panel */

interface LogViewerProps {
  logs: MockLogEntry[];
  runTraceId: string;
  /** Run đang chạy — chỉ khi đó mới bám đáy (P09). */
  live: boolean;
}

export function LogViewer({ logs, runTraceId, live }: LogViewerProps) {
  /* DEBUG ẩn mặc định (P09): nó chiếm phần lớn số dòng mà hiếm khi là thứ
     người ta đang tìm. Bật lại bằng chip, hoặc bằng nút ở trạng thái rỗng. */
  const [levels, setLevels] = useState<Level[]>(["INFO", "WARN", "ERROR", "FATAL"]);
  const [services, setServices] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [stickToBottom, setStickToBottom] = useState(true);

  const debouncedQuery = useDebounced(query, 300);
  const deferredQuery = useDeferredValue(debouncedQuery);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allServices = useMemo(
    () => [...new Set(logs.map((entry) => entry.service))].sort(),
    [logs],
  );

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return logs.filter((entry) => {
      if (!levels.includes(entry.level)) return false;
      // Không chọn service nào = không lọc, chứ không phải lọc sạch.
      if (services.length > 0 && !services.includes(entry.service)) return false;
      if (!needle) return true;
      return (
        entry.message.toLowerCase().includes(needle) ||
        entry.event.toLowerCase().includes(needle) ||
        entry.service.toLowerCase().includes(needle)
      );
    });
  }, [logs, levels, services, deferredQuery]);

  const hidden = Math.max(0, filtered.length - RENDER_LIMIT);
  const visible = hidden > 0 ? filtered.slice(-RENDER_LIMIT) : filtered;

  /* Bám đáy chỉ khi run đang chạy VÀ người dùng chưa tự cuộn lên. Bám lúc run
     đã kết thúc thì cướp quyền điều khiển: người ta đang đọc dở thì bị kéo đi. */
  useEffect(() => {
    if (!live || !stickToBottom) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible.length, live, stickToBottom]);

  /* Cuộn lên = tự tắt bám đáy. Người dùng cuộn ngược lên nghĩa là họ đang đọc
     phần cũ; kéo họ về đáy sau mỗi dòng mới là hành vi chống lại ý định đó. */
  const onScroll = () => {
    const node = scrollRef.current;
    if (!node || !live) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    if (atBottom !== stickToBottom) setStickToBottom(atBottom);
  };

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    /* Cùng ngôn ngữ với bảng lệnh (CommandPalette): mặt tối `ink-900`, viền
       SÁNG hơn hairline thường (`--line-strong`), và bóng đổ để nó nổi lên
       như một tấm rời chứ không chìm vào trang.

       Khác bảng lệnh đúng một điểm: KHÔNG blur. Bảng lệnh dùng
       `liquid-glass--strong`, nhưng §9.2 cấm kính ở vùng log — chữ mono cỡ
       nhỏ đọc hàng trăm dòng liên tục thì mọi thứ làm nhoè nét đều phản tác
       dụng. Nên tôi lấy đúng sắc độ đó ở dạng ĐẶC: `ink-900` chính là
       rgb(32,29,26), trùng màu gốc của `--lg-tint` bên bảng lệnh.

       LỆCH SPEC CÓ CHỦ Ý: P09 ghi nền `ink-950`. Ở chế độ tối, `ink-950` đúng
       bằng nền trang nên khối log trông như lỗ thủng, không phải tấm bảng.
       Dùng token nên nó tự đảo đúng ở chế độ sáng. */
    <div className="liquid-glass liquid-glass--strong rounded-xl border border-[var(--line)] shadow-[0_8px_24px_rgb(0_0_0/0.35)] overflow-hidden">
      {/* Thanh lọc */}
      <div className="border-b border-[var(--line)] px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1" role="group" aria-label="Lọc theo mức độ">
          {LEVELS.map((level) => (
            <FilterChip
              key={level}
              active={levels.includes(level)}
              onClick={() => setLevels((prev) => toggle(prev, level))}
              className={levels.includes(level) ? LEVEL_TEXT[level] : ""}
            >
              {level}
            </FilterChip>
          ))}
        </div>

        {allServices.length > 1 && (
          <div className="flex items-center gap-1" role="group" aria-label="Lọc theo dịch vụ">
            {allServices.map((service) => (
              <FilterChip
                key={service}
                active={services.includes(service)}
                onClick={() => setServices((prev) => toggle(prev, service))}
                className={services.includes(service) ? "text-cyan-400" : ""}
              >
                {service}
              </FilterChip>
            ))}
          </div>
        )}

        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm trong nhật ký…"
          aria-label="Tìm trong nhật ký"
          className="ml-auto h-7 w-44 bg-ink-950 rounded-md px-2.5 text-[12px] font-mono text-paper-50 placeholder:text-haze-500 focus:outline-none focus-ring"
        />

        {live && (
          <FilterChip active={stickToBottom} onClick={() => setStickToBottom((v) => !v)}>
            Bám đáy
          </FilterChip>
        )}
      </div>

      {/* Danh sách */}
      {filtered.length === 0 ? (
        <div className="p-6 flex flex-col items-center gap-3">
          <EmptyState
            message={
              logs.length === 0
                ? "Chưa có nhật ký cho lượt chạy này."
                : "Không có log nào ở mức đang chọn."
            }
          />
          {logs.length > 0 && !levels.includes("DEBUG") && (
            <button
              type="button"
              onClick={() => setLevels(LEVELS)}
              className="btn-ghost !h-7 !text-[12px] focus-ring"
            >
              Hiện cả DEBUG
            </button>
          )}
        </div>
      ) : (
        <>
          {hidden > 0 && (
            <p className="px-3 py-1.5 text-[11px] text-haze-500 border-b border-[var(--line)]">
              Đang hiện {RENDER_LIMIT} dòng mới nhất · ẩn {hidden} dòng cũ hơn — thu hẹp bộ lọc để xem
            </p>
          )}
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="max-h-[520px] overflow-y-auto font-mono text-[12px]"
            role="log"
            aria-live={live ? "polite" : "off"}
            aria-label="Nhật ký lượt chạy"
          >
            <ul>
              {visible.map((entry, index) => (
                <LogRow
                  key={`${entry.timestamp}-${entry.event}-${index}`}
                  entry={entry}
                  showTrace={Boolean(entry.trace_id) && entry.trace_id !== runTraceId}
                />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
