"use client";
/* useCameraSession — nguồn hình của khung camera.
 *
 * Bản gốc của hook này đàm phán WebRTC: xin cấu hình ICE, dựng
 * `RTCPeerConnection`, gửi offer, gom track theo transceiver, chạy vòng
 * `getStats`, và có cả một thang thử lại. Ở dự án này KHÔNG có gì trong số đó,
 * vì `edge_vla` không nói WebRTC — nó phát đúng một route cho trình duyệt:
 *
 *     GET /mjpeg  →  multipart/x-mixed-replace  (edge_vla/server.py)
 *
 * Thẻ `<img>` tự lo hết phần còn lại: mở kết nối, thay khung hình, giữ luồng.
 * Nên hook này không còn gì để quản lý, và nó thu lại thành một hằng số.
 *
 * Đã cân nhắc giữ nhánh WebRTC cho tương lai rồi bỏ: nó trỏ tới
 * `/api/webrtc/config` và `/api/webrtc/offer`, hai route handler không tồn tại
 * trong dự án này. Code chết trỏ vào endpoint chết không phải là "để dành" —
 * nó là một cái bẫy cho người đọc sau, tưởng có đường WebRTC dùng được. Muốn
 * WebRTC thật thì thêm endpoint vào `edge_vla` trước, rồi dựng lại hook.
 *
 * Giữ nguyên KIỂU trả về của bản gốc để `CameraPanel` không phải biết chuyện
 * này đã xảy ra. */

export type CameraConnectionState = "connecting" | "connected" | "reconnecting" | "failed";
export type CameraMode = "webrtc" | "mjpeg";
export type CameraName = "top" | "wrist";

export interface CameraStats {
  fps: number | null;
  latencyMs: number | null;
}

export type CameraStreams = Record<CameraName, MediaStream | null>;

export interface CameraSession {
  connectionState: CameraConnectionState;
  mode: CameraMode;
  stats: CameraStats;
  /** Luôn rỗng ở chế độ MJPEG — không có `MediaStream` nào được tạo. */
  streams: CameraStreams;
  errorCode: string | null;
  retriesExhausted: boolean;
  reconnect: () => void;
}

interface UseCameraSessionArgs {
  robotId: string;
  active?: boolean;
}

/* `fps` và `latencyMs` để `null` chứ KHÔNG bịa số: trình duyệt không cho biết
   tốc độ khung hình của một luồng multipart, và một con số sai còn tệ hơn chỗ
   trống — người vận hành sẽ tin nó khi phán đoán robot có phản hồi kịp hay
   không. `CameraPanel` bỏ hẳn badge khi thiếu cả hai giá trị.

   `connectionState` là "connected" ngay: không có bước bắt tay nào để mà chờ.
   Luồng hỏng thì chính thẻ `<img>` báo qua `onError`, và `CameraPanel` giữ cờ
   đó — hook này không có cách nào biết. */
const MJPEG_SESSION: CameraSession = {
  connectionState: "connected",
  mode: "mjpeg",
  stats: { fps: null, latencyMs: null },
  streams: { top: null, wrist: null },
  errorCode: null,
  retriesExhausted: false,
  reconnect: () => {},
};

export function useCameraSession(_args: UseCameraSessionArgs): CameraSession {
  void _args;
  return MJPEG_SESSION;
}
