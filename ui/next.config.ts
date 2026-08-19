import type { NextConfig } from "next";

/* Cloud Agent (FastAPI) — `run_server.sh`, mặc định :8000. */
const AGENT_BASE = (process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
/* edge_vla (FastMCP + luồng MJPEG) — `run_edge.sh`, mặc định :8931. */
const EDGE_BASE = (process.env.EDGE_BASE_URL ?? "http://127.0.0.1:8931").replace(/\/$/, "");

const nextConfig: NextConfig = {
  /* TẮT gzip của Next. Bắt buộc, không phải tối ưu.
   *
   * Next nén mọi phản hồi khi client gửi `Accept-Encoding: gzip` — và trình
   * duyệt luôn gửi. Với một luồng SSE, bộ nén giữ dữ liệu trong bộ đệm cho tới
   * lúc luồng đóng, nên toàn bộ sự kiện của một lượt chạy đổ xuống cùng lúc ở
   * cuối. Agent trace vì thế hiện "một phát" thay vì hiện dần, dù backend nhả
   * đúng nhịp.
   *
   * Đo được, cùng một lượt chạy: `fetch` thẳng backend nhận sự kiện ở 0.02s rồi
   * 1.28s; qua Next thì mọi sự kiện đến ở 5.58s. Ép `Accept-Encoding: identity`
   * phía client là hết — nhưng trình duyệt CẤM đặt header đó từ `fetch`. Đặt
   * `Content-Encoding: identity` trên phản hồi cũng không ăn: Next vẫn nén đè.
   * Công tắc này là chỗ duy nhất tắt được.
   *
   * Với dự án này nó còn quan trọng hơn bản gốc: `POST /chat` là luồng SSE DUY
   * NHẤT, mọi thứ người dùng thấy đều đi qua nó.
   */
  compress: false,

  /* Trình duyệt chỉ nói chuyện với origin của UI; Next chuyển tiếp sang hai
     dịch vụ backend. Không phải để cho đẹp — `server/main.py` KHÔNG cài
     `CORSMiddleware`, nên gọi thẳng :8000 từ :3000 sẽ bị chặn. */
  async rewrites() {
    return [
      { source: "/chat", destination: `${AGENT_BASE}/chat` },
      { source: "/go_home", destination: `${AGENT_BASE}/go_home` },
      { source: "/health", destination: `${AGENT_BASE}/health` },
      { source: "/mjpeg", destination: `${EDGE_BASE}/mjpeg` },
    ];
  },
};

// `next dev` only — ignored by `next build` / `next start`. Without this, an
// ngrok/cloudflare tunnel serves HTML but no JS, so buttons look fine and do nothing.
if (process.env.NODE_ENV !== "production") {
  nextConfig.allowedDevOrigins = [
    "*.ngrok-free.app",
    "*.ngrok.io",
    "*.trycloudflare.com",
  ];
}

export default nextConfig;
