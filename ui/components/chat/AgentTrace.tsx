"use client";
/* AgentTrace — chặng đường agent đã đi trong một lượt chạy.
 *
 * MỘT danh sách duy nhất trộn hai nguồn:
 *   · bước giai đoạn từ `agent.status`  → "Đang lập kế hoạch"
 *   · hành động thật từ tool call        → "Chụp ảnh camera trên và cổ tay"
 *
 * Trước đây hai thứ này nằm ở hai khối riêng — `AgentSteps` phía trên, danh
 * sách `ToolCard` phía dưới — nên cùng một việc được kể hai lần trong một bong
 * bóng, và danh sách bước thì chung chung tới mức mọi lượt chat trông giống
 * hệt nhau. Gộp lại, mỗi hàng tool bấm vào là xổ ra đúng nội dung `ToolCard`
 * cũ (ảnh, bảng khớp, thanh tiến độ episode).
 *
 * PHÂN CẤP, KHÔNG PHẲNG. Bản trước xếp giai đoạn và tool thành các dòng NGANG
 * HÀNG nhau, cùng cỡ chữ, cùng cột thời lượng. Hai chục dòng như vậy đọc ra một
 * bức tường: "Đang quan sát" và "Đã chụp ảnh xong" trông ngang nhau, trong khi
 * cái đầu là TÊN CHẶNG còn cái sau là VIỆC ĐÃ LÀM trong chặng đó. Giờ giai đoạn
 * thành tiêu đề nhỏ in hoa, tool nằm thụt vào dưới nó trên một vạch dọc — liếc
 * một cái là thấy agent đã đi qua mấy chặng và mỗi chặng làm những gì.
 *
 * RANH GIỚI §13.2 vẫn nguyên: mọi chữ ở đây hoặc là nhãn thuộc tập đóng của
 * spec, hoặc là tên tool + tham số backend thật sự gửi. Suy nghĩ của model KHÔNG
 * đi qua đây — nó có khối riêng (`ThinkingBlock`), dán nhãn riêng.
 */

import { useState } from "react";
import { Check, Loader, ChevronDown } from "lucide-react";
import type { AgentStep, AgentStatusLabel, ToolCall } from "@/stores";
import { useTicker } from "@/hooks/useTicker";
import { formatDurationMs } from "@/lib/format";
import { TOOL_ICON, DEFAULT_TOOL_ICON, describeToolProgress, isTraceHiddenTool } from "@/lib/tool-display";
import { TOOL_STATUS_STYLE } from "./ToolCard";
import { ToolCallBody } from "./ToolCallBody";

/* ------------------------------------------------------------------ model */

type TraceRow =
  | { kind: "phase"; id: string; label: AgentStatusLabel; startedAt: number; endedAt?: number }
  | { kind: "tool"; id: string; call: ToolCall };

/** Một chặng kèm những việc đã làm trong chặng đó.

    `phase` có thể `null`: tool nổ trước khi backend kịp phát nhãn giai đoạn nào
    (hoặc lịch sử cũ không có nhãn). Lúc đó nhóm không có tiêu đề, tool vẫn hiện
    — thà thiếu tiêu đề còn hơn giấu mất một việc robot đã thực sự làm. */
interface TraceGroup {
  id: string;
  phase: Extract<TraceRow, { kind: "phase" }> | null;
  tools: ToolCall[];
}

/** Trộn bước giai đoạn và tool call theo đúng thứ tự chúng ĐẾN.
 *
 * Tool phải nằm xen giữa các giai đoạn chứ không dồn xuống cuối — "Chụp ảnh"
 * xảy ra SAU "Đang quan sát" và TRƯỚC "Đang lập kế hoạch", và trace chỉ có ích
 * khi nó phản ánh đúng trình tự đó.
 *
 * Lịch sử tải từ server không có `started_at` (nó là mốc client tự đo lúc chạy
 * live). Khi thiếu, giữ nguyên thứ tự mảng bằng cách xếp xuống cuối theo chỉ
 * số — chứ không đoán một mốc thời gian không có thật. */
function buildTrace(steps: AgentStep[], toolCalls: ToolCall[]): TraceRow[] {
  const phases = steps.map((step, i) => ({
    order: step.startedAt,
    /* Trùng mốc thì GIAI ĐOẠN đứng trước TOOL. Backend phát `agent.status`
       ngay trước khi gọi tool, nên hai mốc hay bằng nhau tới từng mili-giây;
       để tool lên trước thì trace đọc ra "chụp ảnh rồi mới quan sát". */
    group: 0,
    tie: i,
    row: { kind: "phase" as const, id: step.id, label: step.label, startedAt: step.startedAt, endedAt: step.endedAt },
  }));

  const tools = toolCalls
    .filter((call) => !isTraceHiddenTool(call.tool_name))
    .map((call, i) => ({
      order: call.started_at ?? Number.POSITIVE_INFINITY,
      group: 1,
      tie: i,
      row: { kind: "tool" as const, id: call.id, call },
    }));

  return [...phases, ...tools]
    .sort((a, b) => a.order - b.order || a.group - b.group || a.tie - b.tie)
    .map((entry) => entry.row);
}

/** Gom danh sách phẳng thành các nhóm "một chặng + việc đã làm trong chặng đó". */
function groupTrace(rows: TraceRow[]): TraceGroup[] {
  const groups: TraceGroup[] = [];
  for (const row of rows) {
    if (row.kind === "phase") {
      groups.push({ id: row.id, phase: row, tools: [] });
      continue;
    }
    /* Chặng liền trước NUỐT tool này. Chưa có chặng nào thì mở một nhóm không
       tiêu đề. */
    let current = groups[groups.length - 1];
    if (!current) {
      current = { id: `g-${row.id}`, phase: null, tools: [] };
      groups.push(current);
    }
    current.tools.push(row.call);
  }
  return groups;
}

/* -------------------------------------------------------------------- row */

function PhaseHeader({ row, now }: { row: Extract<TraceRow, { kind: "phase" }>; now: number }) {
  const done = row.endedAt !== undefined;
  /* `now` bằng 0 ở lần render trên server — lùi về startedAt để không ra số âm. */
  const end = row.endedAt ?? (now > row.startedAt ? now : row.startedAt);

  return (
    <div className="flex items-center gap-2 py-1">
      {/* Chấm trên vạch dọc, KHÔNG phải biểu tượng: tiêu đề chặng không mang
          trạng thái thành/bại của riêng nó — nó chỉ đánh dấu vị trí. Dấu tích
          và dấu X để dành cho tool, nơi chúng nói một điều có thật. */}
      <span
        aria-hidden="true"
        className={`shrink-0 w-1.5 h-1.5 rounded-full ${done ? "bg-haze-500" : "bg-arc-400 animate-pulse-dot"}`}
      />
      <span className={`eyebrow ${done ? "" : "text-arc-400"}`}>{row.label}</span>
      <span className="flex-1 h-px bg-[var(--line)]" aria-hidden="true" />
      <span className="data text-[10.5px] shrink-0 text-haze-500">{formatDurationMs(end - row.startedAt)}</span>
    </div>
  );
}

function ToolRow({
  call,
  now,
  open,
  onToggle,
  showCameraLink,
}: {
  call: ToolCall;
  now: number;
  open: boolean;
  onToggle: () => void;
  showCameraLink?: boolean;
}) {
  const status = TOOL_STATUS_STYLE[call.status] ?? TOOL_STATUS_STYLE.PENDING;
  const ToolIcon = TOOL_ICON[call.tool_name] ?? DEFAULT_TOOL_ICON;
  /* Chữ ĐỔI khi kết quả về — "Đang chụp ảnh hiện trường..." thành "Đã chụp ảnh
     xong" — đúng như thẻ tool của giao diện cũ tự viết đè lên chính nó. Trước
     đây chỗ này luôn hiện mô tả lời gọi, nên kết quả bị chôn sau một cú bấm. */
  const label = describeToolProgress(call);
  const bodyId = `trace-body-${call.id}`;

  /* Xong thì dùng `duration_ms` của backend — KHÔNG bao giờ thay bằng hiệu số
     client đo được, vì hai con số đó đo hai thứ khác nhau (thời gian tính toán
     thật so với thời gian gói tin đi đường). Chỉ khi đang chạy mới đếm ở client,
     và lúc đó backend chưa có số nào để đưa. */
  const running = call.status === "RUNNING" || call.status === "PENDING";
  const elapsed = running
    ? call.started_at !== undefined && now > call.started_at
      ? formatDurationMs(now - call.started_at)
      : ""
    : formatDurationMs(call.duration_ms);

  return (
    <li className="trace-row-in">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        /* Nền hiện ra khi rê chuột thay cho vạch màu bên trái của bản trước.
           Vạch màu trên MỌI hàng làm cả danh sách thành sọc và không còn chỉ ra
           được hàng nào đáng chú ý; nền theo trạng thái chỉ tô đúng hàng đang
           chạy và hàng hỏng. */
        className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-left focus-ring cursor-pointer transition-colors duration-[120ms] ${
          call.status === "FAILED"
            ? "bg-halt-500/8 hover:bg-halt-500/14"
            : running
              ? "bg-arc-500/8 hover:bg-arc-500/12"
              : "hover:bg-ink-700"
        }`}
      >
        <status.Icon size={12} className={`shrink-0 ${status.iconClass}`} />
        <ToolIcon size={12} className="shrink-0 text-haze-500" />
        {/* `truncate` + `title`: instruction có thể dài tới 8000 ký tự, nhưng cắt
            bằng JS thì tooltip cũng mất theo. */}
        <span
          title={label}
          className={`flex-1 truncate text-[12.5px] ${
            call.status === "FAILED" ? "text-halt-500" : running ? "text-paper-50 shimmer-text" : "text-haze-300"
          }`}
        >
          {label}
        </span>
        {elapsed && (
          <span className={`data text-[11px] shrink-0 ${running ? "text-arc-400" : "text-haze-500"}`}>
            {elapsed}
          </span>
        )}
        <ChevronDown
          size={12}
          className={`shrink-0 text-haze-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Phần thân là ANH EM của nút, không phải con: `ToolCallBody` chứa nút
          (ảnh thumbnail, "Xem camera"), lồng nút trong nút là HTML sai và bàn
          phím sẽ không tới được chúng.

          Lưới 0fr→1fr để chiều cao chạy mượt mà không phải biết trước nội dung
          cao bao nhiêu — thân tool khi thì một dòng chữ, khi thì hai tấm ảnh. */}
      <div
        id={bodyId}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          {/* Chỉ dựng nội dung khi đã mở: thân tool có ảnh và biểu đồ, dựng sẵn
              cho cả hai chục hàng thì mỗi lượt chạy tốn vô ích một đống DOM. */}
          {open && (
            <div className="pt-2 pb-1 pl-6 pr-1">
              <ToolCallBody toolCall={call} showCameraLink={showCameraLink} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ panel */

interface AgentTraceProps {
  steps?: AgentStep[];
  toolCalls?: ToolCall[];
  /** Lượt chạy đang diễn ra — thu gọn lại và chạy đồng hồ. */
  running?: boolean;
  showCameraLink?: boolean;
}

export function AgentTrace({ steps, toolCalls, running = false, showCameraLink }: AgentTraceProps) {
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  // Đồng hồ chỉ chạy khi còn hàng đang mở; xong thì mọi mốc đã cố định.
  const now = useTicker(running);

  const rows = buildTrace(steps ?? [], toolCalls ?? []);
  if (rows.length === 0) return null;

  const failedRow = rows.find((r) => r.kind === "tool" && r.call.status === "FAILED");

  /* KHÔNG có hành động nào thì không hiện khối.
   *
   * "Chào bạn" cũng đi qua đúng bộ máy như "nhặt cốc đỏ": agent vẫn gọi model,
   * vẫn sinh ra vài nhãn giai đoạn. Nhưng "Đã xong 2 bước · Đang lập kế hoạch"
   * treo trên một câu chào thì không nói thêm được gì — nó giống hệt nhau ở mọi
   * lượt trò chuyện, và làm loãng đúng thứ khối này sinh ra để kể.
   *
   * Điều kiện là có ÍT NHẤT MỘT dòng tool: tool là lúc agent chạm vào robot
   * thật — chụp ảnh, đọc trạng thái, ra lệnh — và đó mới là việc người dùng cần
   * theo dõi. Chỉ có nhãn giai đoạn nghĩa là agent chỉ trả lời bằng lời.
   *
   * Tool HỎNG vẫn là một dòng tool, nên nó luôn qua được cửa này — người dùng
   * thấy được vì sao thất bại (§13.1). Còn lượt chạy hỏng mà chưa kịp gọi tool
   * nào thì lỗi đã nằm ở banner và nội dung tin nhắn, không cần khối này.
   *
   * Không sợ nhấp nháy: dòng tool xuất hiện đúng lúc `tool.started` về, nên
   * khối hiện ra ngay khi agent bắt đầu làm gì đó, không phải hiện rồi biến mất.
   * Trong lúc chạy, trạng thái vẫn luôn thấy được ở `AgentStatusLine` trên đầu
   * khung chat — nên ẩn khối này không làm mất thông tin nào. */
  if (!rows.some((r) => r.kind === "tool")) return null;

  const groups = groupTrace(rows);

  /* LUÔN THU, kể cả khi đã xong. Người dùng cần thì tự bấm mở.
   *
   * Trước đây xong là tự bung hết. Với một lượt chạy thật, danh sách dài hơn
   * chục dòng, nên mỗi câu trả lời của agent bị đẩy xuống dưới một bức tường
   * nhật ký — trong khi thứ người ta đọc là CÂU TRẢ LỜI, còn chặng đường chỉ
   * xem khi có gì đó không ổn.
   *
   * §13.1 vẫn được tôn trọng: nó đòi mỗi mắt xích là một phần tử nhìn thấy
   * ĐƯỢC, không đòi luôn hiện sẵn. Dòng tóm tắt nói rõ có bao nhiêu bước và
   * bấm một lần là ra đủ.
   *
   * HAI NGOẠI LỆ:
   *
   * · ĐANG CHẠY thì mở. Đây là toàn bộ điều thú vị của sản phẩm này — người
   *   dùng ngồi xem agent quan sát, lập kế hoạch, ra lệnh cho cánh tay. Giao
   *   diện cũ hiện mọi bước ngay khi chúng xảy ra, và cảm giác "đang có việc
   *   diễn ra" đến từ đúng chỗ đó. Thu gọn lại thành một dòng "Đang thực thi"
   *   thì mấy chục giây robot làm việc trở thành một thanh chờ câm lặng.
   *   Chạy xong nó tự thu, nên câu trả lời vẫn không bị chôn dưới nhật ký.
   *
   * · Có tool HỎNG thì mở, kể cả khi đã xong. Bắt người dùng đi tìm lý do thất
   *   bại là đúng lúc không nên tiết kiệm chỗ.
   *
   * Bấm tay vẫn thắng cả hai: `manuallyOpen` một khi đã đặt thì giữ nguyên. */
  const open = manuallyOpen ?? (running || failedRow !== undefined);

  const last = rows[rows.length - 1];
  const toolCount = rows.filter((r) => r.kind === "tool").length;
  const summary = running
    ? last.kind === "tool"
      ? describeToolProgress(last.call)
      : last.label
    : `Đã thực hiện ${toolCount} thao tác`;

  /* Tổng thời lượng.

     Đang chạy thì lấy theo đồng hồ. Đã xong thì PHẢI lấy theo chính các mốc
     trong dữ liệu — trước đây vẫn dùng `now`, nên với lịch sử cũ nó ra hiệu số
     giữa hôm nay và ngày lượt chạy đó: "97 giờ 57 phút". Không xác định được
     mốc kết thúc thì ẩn hẳn, không đoán (§13.3). */
  const bounds = rows.reduce<{ first: number | null; last: number | null }>(
    (acc, row) => {
      const start = row.kind === "phase" ? row.startedAt : row.call.started_at;
      const end =
        row.kind === "phase"
          ? row.endedAt
          : row.call.started_at !== undefined && row.call.duration_ms !== undefined
            ? row.call.started_at + row.call.duration_ms
            : undefined;
      return {
        first: start === undefined ? acc.first : acc.first === null ? start : Math.min(acc.first, start),
        last: end === undefined ? acc.last : acc.last === null ? end : Math.max(acc.last, end),
      };
    },
    { first: null, last: null },
  );

  const totalMs =
    bounds.first === null
      ? null
      : running
        ? now > bounds.first
          ? now - bounds.first
          : null
        : bounds.last !== null && bounds.last > bounds.first
          ? bounds.last - bounds.first
          : null;

  return (
    <div className="my-2 text-[13px]">
      <button
        type="button"
        onClick={() => setManuallyOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-lg text-left focus-ring cursor-pointer hover:bg-ink-700 transition-colors duration-[120ms]"
      >
        {running ? (
          <Loader size={13} className="shrink-0 text-arc-400 animate-spin-slow" />
        ) : (
          <Check size={13} className="shrink-0 text-jade-400" />
        )}
        <span className={`flex-1 truncate ${running ? "text-paper-50 shimmer-text" : "text-haze-300"}`}>
          {summary}
        </span>
        {/* Tổng thời lượng chỉ có nghĩa khi đồng hồ đang chạy; lịch sử tải về
            không có mốc bắt đầu nên ẩn hẳn thay vì hiện số bịa (§13.3). */}
        {totalMs !== null && (
          <span className="data text-[11.5px] shrink-0 text-haze-500">{formatDurationMs(totalMs)}</span>
        )}
        <ChevronDown
          size={13}
          className={`shrink-0 text-haze-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          {/* Vạch dọc chạy suốt danh sách — cái neo thị giác nói "tất cả những
              dòng này thuộc cùng một lượt chạy". Không có nó thì các nhóm rời
              ra và trace đọc như mấy khối không liên quan. */}
          <ol className="mt-1 pl-3 ml-[6px] border-l border-[var(--line)] space-y-1">
            {groups.map((group) => (
              <li key={group.id}>
                {group.phase && <PhaseHeader row={group.phase} now={now} />}
                {group.tools.length > 0 && (
                  <ul className="space-y-0.5">
                    {group.tools.map((call) => (
                      <ToolRow
                        key={call.id}
                        call={call}
                        now={now}
                        showCameraLink={showCameraLink}
                        // Accordion: mở một hàng thì hàng kia đóng, tránh khối cao vô hạn.
                        open={(openRowId ?? failedRow?.id) === call.id}
                        onToggle={() => setOpenRowId(openRowId === call.id ? null : call.id)}
                      />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
