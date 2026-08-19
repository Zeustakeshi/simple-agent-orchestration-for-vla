"use client";
/* ThinkingBlock — suy nghĩ nội bộ của model, đặt đúng chỗ của nó.
 *
 * Trước đây thứ này không có chỗ nào cả, nên với model harmony nó đổ thẳng vào
 * bong bóng trả lời kèm cả `<|channel|>thought`. Người dùng đọc được nguyên văn
 * chuỗi suy luận nhưng lại KHÔNG đọc được câu trả lời, vì câu trả lời nằm lẫn
 * trong đó.
 *
 * Hai trạng thái, hai mục đích khác nhau:
 *
 *   · ĐANG NGHĨ — hiện vài dòng cuối, mờ dần lên trên, tự trôi. Mục đích không
 *     phải để đọc mà để thấy "có việc đang diễn ra". Mấy giây agent im lặng
 *     giữa hai tool là lúc dễ tưởng ứng dụng treo nhất.
 *   · ĐÃ NGHĨ XONG — thu lại thành MỘT dòng. Suy nghĩ không phải câu trả lời;
 *     để nó bung sẵn thì nó đẩy câu trả lời xuống dưới màn hình.
 *
 * §13.2 (không hiện chain-of-thought như lời của agent) vẫn được giữ: khối này
 * dán nhãn rõ là suy nghĩ, đóng sẵn khi xong, chữ nhạt hơn và nghiêng — không
 * chỗ nào để nhầm nó với câu agent nói với người dùng.
 */

import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { useSmoothText } from "@/hooks/useSmoothText";
import { formatDurationMs } from "@/lib/format";

interface ThinkingBlockProps {
  text: string;
  /** Suy nghĩ còn đang chảy về. */
  streaming?: boolean;
  /** Đã nghĩ trong bao lâu — chỉ hiện khi biết chắc. */
  durationMs?: number;
}

export function ThinkingBlock({ text, streaming = false, durationMs }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);
  const smooth = useSmoothText(text, streaming);

  /* Cửa sổ đang nghĩ tự trôi xuống đáy. Không có nó thì chữ mới chạy ra ngoài
     vùng nhìn thấy và khối đứng im như đã hỏng. */
  useEffect(() => {
    const el = liveRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [smooth]);

  if (!text.trim()) return null;

  if (streaming) {
    return (
      <div className="my-2">
        <div className="flex items-center gap-2 text-[12.5px] text-haze-500">
          <Brain size={13} className="shrink-0 text-arc-400" />
          <span className="shimmer-text font-medium">Đang suy nghĩ</span>
        </div>
        {/* Mặt nạ gradient ở mép trên: chữ cũ mờ dần đi thay vì bị cắt ngang
            một nhát — cùng thủ pháp với khối suy nghĩ của Claude. */}
        <div
          ref={liveRef}
          aria-hidden="true"
          className="mt-1.5 max-h-[4.5em] overflow-hidden text-[12.5px] leading-[1.5] italic text-haze-500 whitespace-pre-wrap break-words thinking-fade"
        >
          {smooth}
        </div>
      </div>
    );
  }

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 text-[12.5px] text-haze-500 hover:text-haze-300 transition-colors duration-[120ms] focus-ring rounded cursor-pointer"
      >
        <Brain size={13} className="shrink-0" />
        <span className="font-medium">
          {durationMs ? `Đã suy nghĩ ${formatDurationMs(durationMs)}` : "Đã suy nghĩ"}
        </span>
        <ChevronDown
          size={12}
          className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Lưới 0fr→1fr: chiều cao chạy mượt mà KHÔNG cần biết trước nội dung cao
          bao nhiêu. `max-height` đoán bừa thì đoạn suy nghĩ dài bị cắt cụt, còn
          đoán thừa thì hoạt hoạ giật ở cuối. */}
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <p className="mt-2 pl-[21px] border-l border-[var(--line)] ml-[6px] text-[12.5px] leading-[1.55] italic text-haze-500 whitespace-pre-wrap break-words">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}
