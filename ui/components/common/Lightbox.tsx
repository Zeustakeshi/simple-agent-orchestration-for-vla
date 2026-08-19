"use client";
/* Lightbox — P04 §7 "Ảnh" tab
   Chrome uses .liquid-glass--strong (whitelist slot 3, MASTER §9.1) because the
   backdrop is the user's own image. ←/→/Esc navigation, download button. */

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Download } from "lucide-react";

export interface ImageRef {
  id: string;
  url: string;
  camera: "top" | "wrist";
  captured_at: string;
  /** Alt text supplied by the backend; never invented client-side (MASTER §13.3). */
  description?: string;
}

interface LightboxProps {
  images: ImageRef[];
  index: number | null;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}

export function Lightbox({ images, index, onClose, onIndexChange }: LightboxProps) {
  const open = index !== null && index >= 0 && index < images.length;

  /* GỘP NHÁNH: develop thêm ở đây một cờ `mounted` + `requestAnimationFrame`
     để hoãn portal tới sau khi hydrate. Bỏ đi, không phải vì trùng lặp mà vì
     nó không có tác dụng: cờ đó không hề được đọc ở đâu, và điều kiện thật sự
     chặn portal nằm ở `typeof document === "undefined"` phía dưới. Giữ lại thì
     mỗi lần mount tốn thêm một lượt render mà không đổi gì. */

  const goPrev = useCallback(() => {
    if (index === null) return;
    onIndexChange((index - 1 + images.length) % images.length);
  }, [index, images.length, onIndexChange]);

  const goNext = useCallback(() => {
    if (index === null) return;
    onIndexChange((index + 1) % images.length);
  }, [index, images.length, onIndexChange]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, goPrev, goNext]);

  /* Panel bao ngoài có backdrop-filter → nó thành containing block, và phần tử
     `position: fixed` bên trong sẽ bị neo vào panel thay vì vào viewport. Portal
     thẳng ra body là cách duy nhất giữ được toàn màn hình.
     Không cần cờ "đã mount": lightbox chỉ mở sau một cú bấm, nên tới đây chắc
     chắn đã ở phía client. */
  if (!open || index === null || typeof document === "undefined") return null;
  const image = images[index];
  const cameraLabel = image.camera === "top" ? "camera trên" : "camera cổ tay";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ảnh ${index + 1} trên ${images.length} từ ${cameraLabel}`}
      /* The backdrop is always black, so the chrome keeps the dark palette
         even when the app is in light theme. */
      data-theme="dark"
      className="fixed inset-0 z-[60] flex items-center justify-center"
    >
      <div className="absolute inset-0 bg-black/85" onClick={onClose} aria-hidden="true" />

      {/* eslint-disable-next-line @next/next/no-img-element -- artifact URLs are backend-signed, not statically known */}
      <img
        src={image.url}
        alt={image.description ?? `Ảnh chụp từ ${cameraLabel} lúc ${image.captured_at}`}
        className="relative max-w-[92vw] max-h-[86vh] object-contain rounded-lg"
      />

      {/* Chrome — the one place .liquid-glass--strong is allowed over an image */}
      <div className="liquid-glass liquid-glass--strong absolute top-4 right-4 flex items-center gap-1 rounded-full px-1.5 py-1">
        <a
          href={image.url}
          download
          className="p-2 rounded-full text-paper-50 hover:bg-white/10 transition-colors duration-[120ms] focus-ring"
          aria-label="Tải ảnh xuống"
        >
          <Download size={16} />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full text-paper-50 hover:bg-white/10 transition-colors duration-[120ms] focus-ring cursor-pointer"
          aria-label="Đóng"
        >
          <X size={16} />
        </button>
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={goPrev}
            aria-label="Ảnh trước"
            className="liquid-glass liquid-glass--strong absolute left-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full text-paper-50 hover:bg-white/10 transition-colors duration-[120ms] focus-ring cursor-pointer"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Ảnh tiếp theo"
            className="liquid-glass liquid-glass--strong absolute right-4 top-1/2 -translate-y-1/2 p-2.5 rounded-full text-paper-50 hover:bg-white/10 transition-colors duration-[120ms] focus-ring cursor-pointer"
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 data text-[11.5px] text-paper-50/80">
        {index + 1}/{images.length} · {cameraLabel}
      </div>
    </div>,
    document.body,
  );
}
