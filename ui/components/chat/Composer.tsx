"use client";
/* Composer — P04 §6
   Enter sends, Shift+Enter breaks the line, auto-resize up to 6 rows.
   Locked by the §11.2 matrix with the reason shown, placeholder from §11.3.
   Each press generates a fresh Idempotency-Key; a retry reuses the old one. */

import { useState, useRef, useCallback, useEffect } from "react";
import { SendHorizontal } from "lucide-react";
import type { RobotStatus, ConnectionStatus } from "@/stores";
import { actionAvailability, composerPlaceholder } from "@/lib/robot-actions";
import { DisabledHint } from "@/components/common/DisabledHint";

const MAX_CHARS = 8000;
/** Khớp với `leading-5` của textarea; py-3 hai đầu cộng thêm 24px. */
const LINE_HEIGHT = 20;
const VERTICAL_PADDING = 24;

interface ComposerProps {
  robotStatus: RobotStatus;
  connectionStatus: ConnectionStatus;
  /** True while a run is in flight — locks the box regardless of robot state. */
  composerLocked: boolean;
  onSend: (text: string, idempotencyKey: string) => void;
  /** Text pushed in from "Chạy lại" (P09) — filled in, never auto-sent. */
  prefillText?: string;
  /** Ẩn chip gợi ý khi hội thoại đã bắt đầu — chúng chỉ để mồi lượt đầu. */
  showSuggestions?: boolean;
}

/* Lệnh mồi, chuyển nguyên từ hàng chip của giao diện cũ (`ui/index.html`).
   Chúng không phải nút bấm gọi thẳng tool: mỗi cái chỉ là một câu tiếng Việt gửi
   cho agent, đúng như người dùng tự gõ. Giữ đúng bản chất đó — một hàng nút gọi
   tool trực tiếp sẽ đi vòng qua agent và qua cả các ràng buộc an toàn của nó. */
const QUICK_COMMANDS = [
  { emoji: "🥛", text: "bỏ hộp sữa vào giỏ" },
  { emoji: "✋", text: "mở tay" },
  { emoji: "👊", text: "đóng tay" },
  { emoji: "🏠", text: "về nhà" },
  { emoji: "⏹", text: "dừng lại" },
];

export function Composer({
  robotStatus,
  connectionStatus,
  composerLocked,
  onSend,
  prefillText,
  showSuggestions = false,
}: ComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const availability = actionAvailability("sendMessage", robotStatus, connectionStatus);
  const lockedByState = availability.state !== "enabled";
  /* `disabled` chỉ chặn việc GỬI. Ô nhập vẫn gõ được: §11.2 cấm gửi lệnh khi
     robot đang bận vì đó là cánh tay thật đang chuyển động, nhưng soạn sẵn câu
     lệnh tiếp theo thì không đụng tới robot. Khoá luôn ô nhập là siết chặt hơn
     mức spec đòi, và bắt người dùng ngồi chờ tay không. */
  const disabled = composerLocked || lockedByState;
  const reason = composerLocked
    ? "Agent đang xử lý yêu cầu trước đó."
    : availability.state === "disabled"
      ? availability.reason
      : undefined;
  // Ô nhập gõ được nên placeholder phải mời soạn, không chỉ báo bận.
  const placeholder = composerLocked
    ? "Agent đang xử lý — soạn trước câu lệnh tiếp theo…"
    : composerPlaceholder(robotStatus, connectionStatus);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * LINE_HEIGHT + VERTICAL_PADDING)}px`;
  }, [text]);

  // "Chạy lại" pushes text in from outside. Adjusting state during render is the
  // supported way to react to a changed prop without an effect round-trip.
  const [lastPrefill, setLastPrefill] = useState(prefillText);
  if (prefillText !== lastPrefill) {
    setLastPrefill(prefillText);
    if (prefillText) setText(prefillText);
  }

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (disabled || !trimmed) return;
    onSend(trimmed, crypto.randomUUID());
    setText("");
  }, [text, disabled, onSend]);

  /* Chip GỬI luôn, không chỉ điền vào ô. Bản cũ cũng vậy, và đó là lựa chọn
     đúng: chúng là lệnh hoàn chỉnh, bắt bấm thêm một nút nữa chỉ thêm một bước
     mà không thêm thông tin gì để cân nhắc. */
  const sendQuick = useCallback(
    (quick: string) => {
      if (disabled) return;
      onSend(quick, crypto.randomUUID());
      setText("");
    },
    [disabled, onSend],
  );

  const remaining = MAX_CHARS - text.length;

  return (
    <div className="p-3 bg-ink-900/40 backdrop-blur-md shrink-0 relative z-10">
      {showSuggestions && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {QUICK_COMMANDS.map((quick) => (
            <button
              key={quick.text}
              type="button"
              onClick={() => sendQuick(quick.text)}
              disabled={disabled}
              className="h-7 px-3 rounded-full border border-[var(--line)] text-[12px] text-haze-300
                hover:text-paper-50 hover:border-arc-500 hover:bg-arc-500/10
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors duration-[120ms] focus-ring cursor-pointer"
            >
              <span aria-hidden="true" className="mr-1.5">{quick.emoji}</span>
              {quick.text}
            </button>
          ))}
        </div>
      )}
      {/* Nền/viền/bóng nằm ở `.composer-shell` trong globals.css chứ không phải
          ở đây: chúng phải đổi theo theme, mà `bg-white/5` thì không — xem ghi
          chú tại recipe. Hình dạng (bo góc) vẫn là utility. */}
      <div className="relative rounded-3xl composer-shell" title={reason}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={placeholder}
          rows={1}
          aria-label="Ra lệnh cho robot"
          aria-describedby={reason ? "composer-lock-reason" : undefined}
          /* `block`: textarea mặc định là inline-block nên nó ngồi trên đường
             baseline và chừa một khoảng trống vài px ngay dưới, làm khung bao
             cao hơn chính nó — nút định vị theo đáy khung sẽ lệch xuống.

             `leading-5` cho chiều cao mỗi dòng cố định 20px thay vì phụ thuộc
             line-height "normal" của từng font; phép tính auto-resize 6 dòng
             dựa vào con số này.

             `pr-14` chừa chỗ cho nút, thiếu thì dòng cuối chui xuống dưới nút
             và mất mấy chữ. `bg-transparent` vì nền và bo góc do khung bao vẽ.

             `px-5` chứ không phải `px-4`: khung bo tròn hẳn nên mép trái là một
             đường cong, chữ sát quá sẽ đâm vào chỗ cong. */
          className="block w-full bg-transparent px-5 py-3 pr-14 text-[14px] leading-5 text-paper-50 placeholder:text-haze-500 resize-none focus:outline-none"
        />

        {remaining < 500 && (
          /* Bên TRÁI nút, không phải góc phải — góc đó nút chiếm rồi. Cùng
             `bottom` và cùng chiều cao với nút, nên hai thứ luôn chung một
             đường ngang mà không phải tính riêng cho cỡ chữ 11px. */
          <span className="absolute bottom-1 right-14 h-9 flex items-center data text-[11px] text-haze-500">
            {remaining}
          </span>
        )}

        {/* Thẻ bọc luôn tồn tại và mang định vị. Để `DisabledHint` tự bọc một
            nút đã `absolute` thì thẻ span của nó rộng 0, và tooltip lý do khoá
            không hover được — đúng thứ `DisabledHint` sinh ra để sửa.

            `flex` KHÔNG phải để xếp bố cục mà để bỏ dòng nền: `<button>` là
            inline-block nên trong một thẻ bọc thường nó ngồi trên baseline và
            chừa ~4px descender phía DƯỚI. Thẻ bọc vì thế cao ~40px trong khi
            nút chỉ 36px, và `bottom-*` đo tới đáy thẻ bọc chứ không tới đáy
            nút — nút bị đội lên đúng phần dôi ra đó. Đây chính là lỗi đang
            thấy, và cũng đúng cái bẫy mà `block` trên textarea phía trên đã
            phải xử lý. `flex` tạo flex formatting context, không có baseline,
            thẻ bọc cao đúng 36px.

            Số 4px (`bottom-1`/`right-1`) là phép tính, không phải ước lượng:
            khung một dòng cao 20 + 24 = 44px, nút 36px → (44−36)/2 = 4. Tâm
            nút nằm đúng đường giữa khung. Cùng số đó theo chiều ngang đặt tâm
            nút cách mép phải 22px = bán kính của đầu bo, nên nút và đầu khung
            đồng tâm; khung giãn nhiều dòng thì nút tụt xuống ôm góc dưới-phải,
            vẫn đồng tâm với góc đó. */}
        <div className="absolute bottom-1 right-1 flex">
          <DisabledHint reason={reason}>
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || !text.trim()}
              title={reason ? undefined : "Gửi (Enter)"}
              aria-label="Gửi lệnh"
              className="w-9 h-9 rounded-full bg-arc-500 flex items-center justify-center text-white shrink-0 hover:bg-arc-hover transition-colors duration-[120ms] disabled:opacity-40 disabled:cursor-not-allowed focus-ring cursor-pointer"
            >
              <SendHorizontal size={18} />
            </button>
          </DisabledHint>
        </div>
      </div>

      {/* Lý do bị khoá, hiện thẳng chứ không chỉ trong tooltip */}
      {reason && (
        <p id="composer-lock-reason" className="mt-1.5 text-[12px] text-haze-500">
          {reason}
          {text.trim() && " Câu lệnh của bạn được giữ nguyên, gửi được ngay khi robot rảnh."}
        </p>
      )}
    </div>
  );
}
