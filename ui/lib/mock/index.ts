/* Mock data layer — MASTER §19
   USE_MOCK flag + delay/error utilities
   Switching to real API = setting NEXT_PUBLIC_USE_MOCK=0 */

import { USE_MOCK } from "@/lib/api/config";

export { USE_MOCK };

/* Không còn cờ `CAMERA_LIVE`. Camera ở dự án này LUÔN lấy MJPEG thật từ
   edge_vla — không có phiên bản mock nào của luồng đó để mà chuyển qua lại, và
   một cờ không bao giờ đổi được giá trị chỉ làm người đọc tưởng có lựa chọn.
   Xem `components/camera/useCameraSession.ts`. */

/** Simulate network delay 200-800ms with configurable error rate */
export function mockDelay<T>(data: T, errorRate = 0.05): Promise<T> {
  const delay = 200 + Math.random() * 600;
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() < errorRate) {
        reject(createMockError());
      } else {
        resolve(data);
      }
    }, delay);
  });
}

function createMockError(): Error {
  const errors = [
    { code: "SYS_001", message: "Lỗi hệ thống nội bộ" },
    { code: "NET_001", message: "Không thể kết nối máy chủ" },
    { code: "AUTH_005", message: "Phiên đăng nhập hết hạn" },
  ];
  const err = errors[Math.floor(Math.random() * errors.length)];
  const error = new Error(err.message);
  (error as Error & { code: string }).code = err.code;
  return error;
}
