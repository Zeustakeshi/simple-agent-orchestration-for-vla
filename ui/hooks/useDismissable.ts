"use client";
/* useDismissable — MASTER §15
   Popover/menu phải đóng được bằng Esc và bằng cú bấm ra ngoài, không chỉ bằng
   `onMouseLeave` — nếu không thì người dùng bàn phím mở ra rồi mắc kẹt.

   Dùng `pointerdown` thay vì `click`: bắt sớm hơn, nên menu đóng ngay cả khi cú
   bấm rơi vào một phần tử bị gỡ khỏi DOM trước lúc `click` kịp bắn. */

import { useEffect, type RefObject } from "react";

export function useDismissable(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, ref, onDismiss]);
}
