"use client";
/* HaltButton — MASTER §12.1, IMMUTABLE
   Deliberately NOT behind a confirmation dialog: DOC 2 §9.1 requires ≤500ms
   from click to an IDLE badge, and stopping an idle robot by mistake is
   harmless while failing to stop a colliding one is not. Confirmation is
   reserved for destructive actions (§12.3).

   Also: never `disabled` — not when the robot is offline, not when the
   composer is locked. The Cloud reports back if the command cannot be
   delivered. No optimistic update: the label waits for the real response.

   The only auto-retry allowed anywhere in the app lives here (up to 3 attempts
   in 2s) because it stops motion rather than creating it.

   Fill uses halt-600, not halt-500: halt-500 is the error *text* red and is too
   light to carry white text (3.1:1). halt-600 gets 5.33:1, which the button
   needs — §15 asks for 4.5:1 and this is the one control that must never be
   misread. */

import { OctagonX, Loader } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { stopRobot } from "@/lib/api/robots";
import { CHAT_LIVE } from "@/lib/api/config";
import { toast } from "@/stores";
import { errorText, toErrorObject } from "@/lib/errors";

interface HaltButtonProps {
  robotId: string;
  /** Visibility follows the §11.2 matrix — the parent decides, never `disabled`. */
  visible: boolean;
  className?: string;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

/* Nhãn phải nói đúng việc nút LÀM.
   Với backend mvp_vla, `stopRobot` gọi `/go_home` — cánh tay rút về vị trí an
   toàn, chứ không phải cắt điện tức thì. Xem chú thích ở `lib/api/robots.ts`.
   Gọi nó là "Dừng" thì người vận hành sẽ bấm rồi chờ robot đứng im ngay lập
   tức, và mất mấy giây quý giá để hiểu ra là nó vẫn đang di chuyển. */
const LABEL = CHAT_LIVE
  ? { idle: "Về an toàn", busy: "Đang về…", aria: "Đưa robot về vị trí an toàn", sent: "Đã gửi lệnh về vị trí an toàn." }
  : { idle: "Dừng", busy: "Đang dừng…", aria: "Dừng khẩn cấp robot", sent: "Đã gửi lệnh dừng." };

export function HaltButton({ robotId, visible, className = "" }: HaltButtonProps) {
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleStop = useCallback(async () => {
    if (pending) return;
    setPending(true);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await stopRobot(robotId);
        if (mounted.current) setPending(false);
        toast.success(LABEL.sent);
        return;
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) {
          if (mounted.current) setPending(false);
          toast.error(errorText(toErrorObject(err)));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }, [robotId, pending]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={handleStop}
      aria-label={LABEL.aria}
      title={`${LABEL.aria} — phím tắt: nhấn Esc hai lần`}
      /* Mặt đỏ đặc, KHÔNG viền, KHÔNG quầng sáng.

         §12.1 mô tả thêm `border-halt-700` và một quầng `0 0 0 3px`. Ba lớp
         cạnh chồng nhau — quầng, viền, rồi mép nút — đọc ra thành ba khung lồng
         vào nhau chứ không ra một nút. Cái làm nút này nổi bật vốn không phải
         quầng sáng: nó là khối đỏ bão hoà duy nhất trên toàn màn hình, cao hơn
         nút thường (44 vs 36px) và rộng hơn.

         Giữ nguyên mọi ràng buộc chức năng: kích thước, vùng chạm ≥44px, không
         bao giờ disabled, không dialog xác nhận, hover đậm hơn, focus ring. */
      /* Giữ h-11 = 44px: đó là ngưỡng vùng chạm tối thiểu của §12.1 và cũng là
         mức WCAG 2.5.5 đòi. Chỉ thu chiều RỘNG — `min-w-[132px]` mà spec ghi ép
         thêm ~36px trống quanh chữ "Dừng" vốn rất ngắn, và đó mới là thứ làm nút
         trông kềnh. 112px vẫn rộng hơn nút thường đúng như §12.1 muốn. */
      className={`inline-flex items-center justify-center gap-2 h-11 min-w-[112px] px-4 rounded-lg
        bg-halt-600 text-white text-[14px] font-semibold tracking-[-0.01em]
        shadow-[inset_0_1px_0_rgb(255_255_255/0.14)]
        hover:bg-halt-700 active:translate-y-px
        transition-colors duration-[120ms]
        focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-halt-500 focus-visible:ring-offset-2
        focus-visible:ring-offset-ink-900
        cursor-pointer shrink-0
        ${className}`}
    >
      {pending ? (
        <Loader size={17} strokeWidth={2} className="animate-spin-slow" />
      ) : (
        <OctagonX size={17} strokeWidth={2} />
      )}
      <span>{pending ? LABEL.busy : LABEL.idle}</span>
    </button>
  );
}
