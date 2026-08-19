"use client";
/* useTicker — nguồn thời gian cho các con số đếm lên (thời lượng đang chạy).

   Vì sao không làm cách hiển nhiên:
     · gọi `Date.now()` thẳng trong render là hàm không thuần, và hai lần render
       trong cùng một khung hình sẽ ra hai giá trị khác nhau;
     · nhồi `setState` vào `useEffect` để tự đẩy render thì gây chuỗi render nối
       tiếp, và ESLint chặn đúng lý do đó.

   `useSyncExternalStore` sinh ra cho đúng bài này: nó cho phép đọc một nguồn
   thay đổi bên ngoài React, miễn là `getSnapshot` trả về giá trị ĐÃ CACHE — nên
   giá trị được giữ trong biến module, chỉ interval mới cập nhật.

   Một interval duy nhất dùng chung cho mọi component đang đếm, và tự tắt khi
   không còn ai nghe (§16: không để đồng hồ chạy vô ích). */

import { useSyncExternalStore } from "react";

let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribeTicker(onChange: () => void) {
  listeners.add(onChange);
  if (timer === null) {
    // Làm mới ngay khi có người nghe đầu tiên: React gọi lại getSnapshot sau
    // khi subscribe, nên giá trị cũ không kịp lọt ra màn hình.
    nowMs = Date.now();
    timer = setInterval(() => {
      nowMs = Date.now();
      listeners.forEach((listener) => listener());
    }, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Không đếm thì không đăng ký gì — hàm ổn định để React không resubscribe. */
function subscribeNever() {
  return () => {};
}

const getSnapshot = () => nowMs;
/** SSR không có đồng hồ chạy; trả mốc cố định để hai bên render khớp nhau. */
const getServerSnapshot = () => 0;

/**
 * Trả về mốc thời gian hiện tại, cập nhật mỗi giây khi `active`.
 * `active = false` thì không có interval nào chạy.
 */
export function useTicker(active: boolean): number {
  return useSyncExternalStore(active ? subscribeTicker : subscribeNever, getSnapshot, getServerSnapshot);
}
