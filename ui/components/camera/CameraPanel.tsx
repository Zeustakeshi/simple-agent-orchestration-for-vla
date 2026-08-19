"use client";
/* CameraPanel — P05
   The robot's camera. This is operational data, NOT the landing-page wallpaper
   video (MASTER §8): it carries a LIVE badge and connection state, and it only
   ever appears inside (app) routes.

   MỘT khung hình, không phải hai. Bản gốc xếp camera trên trên camera cổ tay và
   cho đổi bố cục, vì mỗi camera là một track WebRTC riêng. `edge_vla` ở dự án
   này thì GHÉP agentview và wrist nằm cạnh nhau vào cùng một ảnh trước khi mã
   hoá (`edge_vla/viewer.py`), nên hai luồng riêng không tồn tại để mà tách —
   bố cục "Cả hai / Top / Wrist" sẽ là ba nút bấm vào không đổi được gì. */

import { useEffect, useRef, useState, useCallback } from "react";
import { Camera as CameraIcon, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { useCameraSession } from "./useCameraSession";
import { MJPEG_PATH } from "@/lib/api/config";

interface CameraPanelProps {
  robotId: string;
  robotName: string;
  /** Robot is offline — camera is unreachable (§11.2 "Xem camera" = ⛔). */
  unavailableReason?: string;
  /** False when the panel's tab is not showing, so decoding can pause. */
  active?: boolean;
  className?: string;
}

/* ---------------------------------------------------------------- HUD */

function HudBadge({ children, dotClass }: { children: React.ReactNode; dotClass?: string }) {
  return (
    <div className="liquid-glass liquid-glass--hud rounded-full px-2.5 py-1 text-[11px] font-mono tabular-nums text-paper-50 flex items-center gap-1.5">
      {dotClass && <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- panel */

export function CameraPanel({
  robotId,
  robotName,
  unavailableReason,
  active = true,
  className = "",
}: CameraPanelProps) {
  const [documentHidden, setDocumentHidden] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [compactHud, setCompactHud] = useState(false);
  /* MJPEG không có state machine như WebRTC — luồng hỏng thì chỉ thẻ `<img>`
     biết, qua `onError`. Không giữ riêng cờ này thì camera chết vẫn hiện badge
     "Đã kết nối" mãi mãi. */
  const [broken, setBroken] = useState(false);
  /* Đổi để React dựng lại thẻ `<img>` khi thử lại: giữ nguyên `src` thì trình
     duyệt cũng giữ nguyên phần tử hỏng và không hề gọi lại mạng. */
  const [reloadKey, setReloadKey] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);

  const session = useCameraSession({ robotId, active: !unavailableReason && active && !documentHidden });

  // Tab visibility — stop burning GPU on a hidden tab (MASTER §16).
  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // 768–1279px keeps only the connection badge (MASTER §17).
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1279px)");
    const apply = () => setCompactHud(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen?.();
  }, []);

  const retry = useCallback(() => {
    setBroken(false);
    setReloadKey((k) => k + 1);
    session.reconnect();
  }, [session]);

  if (unavailableReason) {
    return (
      <div className={`panel-inset p-6 flex flex-col items-center justify-center gap-2 text-center ${className}`}>
        <CameraIcon size={20} className="text-haze-500" />
        <p className="text-[13px] text-haze-300">{unavailableReason}</p>
      </div>
    );
  }

  const live = !broken && !documentHidden && session.connectionState === "connected";

  return (
    /* The feed is black in either theme, so the frame and its toolbar keep the
       dark palette — a white bar clamped to a black picture reads as a bug. */
    <div
      ref={frameRef}
      data-theme="dark"
      className={`glass-edge flex flex-col bg-black rounded-lg overflow-hidden border border-[var(--line)] ${className}`}
    >
      {/* Toolbar */}
      <div className="h-9 px-2 flex items-center justify-between gap-2 border-b border-[var(--line)] bg-ink-900 shrink-0">
        <span className="text-[11.5px] font-medium text-haze-500 pl-1">Camera robot</span>
        <button
          type="button"
          onClick={toggleFullscreen}
          title={fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
          aria-label={fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình"}
          className="w-7 h-7 flex items-center justify-center rounded text-haze-300 hover:bg-ink-800 hover:text-paper-50 transition-colors duration-[120ms] focus-ring cursor-pointer"
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Feed */}
      <div className="flex-1 min-h-[220px] relative bg-black overflow-hidden">
        {broken ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-4">
            <CameraIcon size={20} className="text-haze-500" />
            <p className="text-[12.5px] text-haze-300">Không nhận được luồng camera.</p>
          </div>
        ) : (
          /* `multipart/x-mixed-replace` tự thay khung hình — không polling, không
             timer. Tạm dừng khi tab ẩn bằng cách gỡ hẳn thẻ: trình duyệt không
             cho "tạm dừng" một luồng multipart, chỉ có mở hoặc đóng. */
          !documentHidden &&
          active && (
            // eslint-disable-next-line @next/next/no-img-element -- MJPEG stream, not a static asset
            <img
              key={reloadKey}
              src={MJPEG_PATH}
              alt={`Ảnh trực tiếp từ camera của robot ${robotName}`}
              onError={() => setBroken(true)}
              className="w-full h-full object-contain"
            />
          )
        )}

        <div className="absolute top-2 left-2 flex flex-wrap gap-1.5 max-w-[85%]">
          {!compactHud && live && <HudBadge dotClass="bg-cyan-400 animate-pulse-dot">LIVE</HudBadge>}
          <HudBadge dotClass={live ? "bg-jade-400" : "bg-halt-500"}>
            {live ? "Đã kết nối" : "Mất kết nối"}
          </HudBadge>
          {!compactHud && <HudBadge>MJPEG</HudBadge>}
        </div>

        <span className="absolute bottom-1.5 left-2 data text-[10.5px] px-1.5 py-0.5 rounded bg-ink-950/70 text-haze-300">
          agentview + wrist
        </span>
      </div>

      {broken && (
        <div className="px-3 py-2 bg-ink-900 border-t border-[var(--line)] flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-halt-500">
            Kiểm tra edge_vla đã chạy chưa (<span className="data">./run_edge.sh</span>).
          </span>
          <button type="button" onClick={retry} className="btn-ghost !h-7 !text-[12px] focus-ring">
            <RefreshCw size={12} />
            Thử kết nối lại camera
          </button>
        </div>
      )}
    </div>
  );
}
