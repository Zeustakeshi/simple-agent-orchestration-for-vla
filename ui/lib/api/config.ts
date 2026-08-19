/**
 * Browser API origin.
 * Empty = same host as the UI (Next.js rewrites /api/* → Cloud). That keeps
 * auth cookies first-party so phones can finish Google login.
 * NEXT_PUBLIC_API_BASE is only the rewrite target in next.config.ts.
 */
export const API_BASE = "";

/** When true, robots/sessions SSE stay on mock; when false, auth + chat hit Cloud. */
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "0";

/** Chat + `/go_home` nối thật vào Cloud Agent của mvp_vla, trong khi phần còn
 *  lại của app vẫn chạy bằng dữ liệu mẫu.
 *
 * Hai cờ tách rời vì backend mvp_vla chỉ có ba đường cho trình duyệt:
 * `POST /chat`, `POST /go_home`, `GET /mjpeg`. Không có API cho danh sách phiên,
 * nhật ký chạy, lịch chạy hay cài đặt — tắt mock toàn app thì những trang đó
 * rỗng hoặc lỗi. Nên `USE_MOCK` giữ chúng chạy bằng dữ liệu mẫu, còn cờ này cho
 * riêng màn hình Điều khiển nói chuyện với robot thật.
 *
 * Mặc định BẬT, phải đặt `=0` mới tắt. Đây là giao diện của chính mvp_vla; chạy
 * nó lên mà chat trả lời bằng kịch bản dựng sẵn thì rất dễ tưởng agent đang
 * hoạt động trong khi chưa có gì được nối. Tắt đi chỉ hữu ích khi dựng giao
 * diện mà không muốn bật GPU và LLM. */
export const CHAT_LIVE = USE_MOCK ? process.env.NEXT_PUBLIC_CHAT_LIVE !== "0" : true;

/** Đường lấy luồng MJPEG. Same-origin, đi qua rewrite của Next sang edge_vla —
    trình duyệt không bao giờ gọi thẳng cổng của edge, nên không cần CORS. */
export const MJPEG_PATH = process.env.NEXT_PUBLIC_MJPEG_PATH ?? "/mjpeg";
