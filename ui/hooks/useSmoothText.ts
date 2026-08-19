"use client";
/* useSmoothText — trả chữ ra màn hình theo nhịp ĐỀU, thay vì theo nhịp mạng.
 *
 * Vì sao cần: model chạy qua LangGraph + SSE không trả token đều tay. Một lượt
 * thật đi thành từng cụm — im lặng 400ms rồi cả một câu đổ ra một lúc, vì đó là
 * nhịp của provider và của bộ đệm SSE, không phải nhịp đọc của người. Nối thẳng
 * `streamingContent` vào DOM thì câu trả lời GIẬT: đứng im, nhảy, đứng im, nhảy.
 *
 * Hook này giữ một con trỏ "đã hiện tới đâu" và đẩy nó tới bằng
 * `requestAnimationFrame`. Tốc độ tỉ lệ với phần đang nợ, nên chữ về dồn dập thì
 * nó chạy nhanh lên chứ không bao giờ tụt lại phía sau — hiệu ứng gõ máy không
 * được phép làm câu trả lời tới muộn hơn thực tế.
 *
 * `prefers-reduced-motion` thì trả thẳng chuỗi đầy đủ, không hoạt hoạ gì (§7).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Ký tự mỗi giây khi hàng đợi gần cạn — nhịp đọc thoải mái. */
const BASE_SPEED = 45;
/** Mỗi ký tự đang nợ cộng thêm ngần này vào tốc độ. Đây là thứ giữ cho độ trễ
    luôn hữu hạn: nợ càng nhiều, chữ càng chảy nhanh. */
const CATCH_UP = 7;

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function motionMedia(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(MOTION_QUERY)
    : null;
}

/* Đọc `prefers-reduced-motion` qua `useSyncExternalStore` chứ không phải
   `useEffect` + `setState`: đây đúng là "một nguồn thay đổi bên ngoài React", và
   cách kia vừa gây một render thừa ngay khi gắn vào DOM vừa bị lint chặn. */
function subscribeMotion(onChange: () => void): () => void {
  const mq = motionMedia();
  if (!mq) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const getMotion = () => motionMedia()?.matches ?? false;
/** SSR không có `matchMedia`; giả định có hoạt hoạ để hai bên render khớp nhau. */
const getServerMotion = () => false;

/**
 * @param text  chuỗi đầy đủ đã nhận được tới lúc này
 * @param streaming  còn đang nhận nữa hay không. `false` thì hiện hết ngay —
 *   chữ đã chốt không có lý do gì phải gõ lại.
 */
export function useSmoothText(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(0);
  /* Con trỏ THẬT nằm ở ref, `shown` chỉ là bản sao để React biết mà vẽ lại.
     Giữ ở ref vì vòng lặp rAF cần đọc giá trị mới nhất mà không phải đợi một
     lượt render, và vì mỗi lần `text` dài thêm thì effect chạy lại — con trỏ
     phải sống sót qua đó. */
  const cursor = useRef({ text: "", shown: 0 });
  const reduced = useSyncExternalStore(subscribeMotion, getMotion, getServerMotion);
  const animate = streaming && !reduced;

  useEffect(() => {
    if (!animate) return;
    const state = cursor.current;
    /* Chuỗi ĐỔI HẲN chứ không phải dài thêm — sang tin nhắn khác. Kéo con trỏ
       về 0 để tin mới cũng được gõ ra, thay vì hiện phịch một cái vì con trỏ
       của tin trước còn đang ở cuối. */
    if (!text.startsWith(state.text)) state.shown = 0;
    state.text = text;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const owed = text.length - state.shown;
      if (owed > 0) {
        const speed = BASE_SPEED + owed * CATCH_UP;
        state.shown = Math.min(text.length, state.shown + Math.max(1, Math.round(dt * speed)));
        setShown(state.shown);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, animate]);

  return animate ? text.slice(0, Math.min(shown, text.length)) : text;
}
