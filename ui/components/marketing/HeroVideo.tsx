"use client";
/* HeroVideo — P00 + MASTER §8
   Đây là VIDEO NỀN (wallpaper), không phải camera robot: trang trí, file tĩnh,
   không badge LIVE, không FPS, không overlay kiểu HUD. Nó là thứ duy nhất
   trong sản phẩm được phép có video nền, và chỉ ở trang chủ.

   Hai hành vi mà CSS không làm thay được:

   1. `prefers-reduced-motion` → KHÔNG PHÁT. Dùng `motion-reduce:hidden` chỉ ẩn
      về mặt thị giác; video vẫn tải và vẫn giải mã từng khung hình. Ở đây không
      render <video> luôn, chỉ còn poster.
   2. Tab ẩn → tạm dừng (§8, §16: không animation nào chạy khi tab không hiện).

   Là leaf client component để trang chủ giữ nguyên Server Component (§18.1). */

import { useEffect, useRef, useState } from "react";

const POSTER = "/media/hero-poster.jpg";

export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Mặc định coi như "giảm chuyển động" cho tới khi đo được, để lần render đầu
  // trên server và trên client khớp nhau và không ai phải tải video oan.
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  /* Phát xuôi, lặp bằng `loop` của trình duyệt, và tạm dừng khi tab ẩn (§8, §16).

     Hiệu ứng tới–lui KHÔNG làm ở đây. Đã thử kéo `currentTime` lùi theo từng
     khung hình (`playbackRate` âm không chạy trên Chrome) và nó giật: video nén
     theo kiểu chỉ lưu khác biệt giữa các khung, nên lùi một khung buộc trình
     duyệt nhảy về keyframe gần nhất rồi giải mã xuôi lại tới đó. Hạ độ phân
     giải chỉ làm nhẹ bớt chứ không hết, mà lại đổi mất chất lượng.

     Cách đúng: nướng sẵn đoạn xuôi + ngược thành một file rồi để `loop` chạy —
     chiều xuống lúc đó cũng là phát xuôi nên mượt y như chiều lên, và giữ
     nguyên độ phân giải gốc. */
  useEffect(() => {
    if (reducedMotion) return;
    const video = videoRef.current;
    if (!video) return;

    const onVisibility = () => {
      if (document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reducedMotion]);

  if (reducedMotion) {
    return (
      <div
        className="absolute inset-0 w-full h-full bg-cover bg-center"
        style={{ backgroundImage: `url(${POSTER})` }}
        aria-hidden="true"
      />
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      loop
      playsInline
      /* `auto` chứ không phải `metadata` như P00 ghi: với `metadata` trình duyệt
         chỉ tải phần đầu rồi vừa phát vừa tải, nên tới điểm lặp nó phải seek về
         0 trên dữ liệu chưa nằm sẵn trong bộ đệm — sinh ra cú khựng đúng chỗ
         chuyển vòng. Clip chỉ 2,5MB nên tải trọn vẹn là đáng, đổi lại vòng lặp
         liền mạch. */
      preload="auto"
      poster={POSTER}
      className="absolute inset-0 w-full h-full object-cover"
      aria-hidden="true"
    >
      {/* Chỉ WebM/VP9. Bỏ bản mp4 dự phòng theo yêu cầu: mọi trình duyệt đời
          mới đều đọc được WebM, nên bản mp4 nằm đó không ai tải. Máy quá cũ
          không đọc được (Safari iOS dưới 17.4) sẽ hiện `poster` — ảnh tĩnh
          đứng yên, xuống cấp êm chứ không vỡ trang. */}
      <source src="/media/hero-loop.webm" type="video/webm" />
    </video>
  );
}
