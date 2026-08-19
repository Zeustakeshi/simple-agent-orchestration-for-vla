/* Trạng thái cấu hình của Cloud — `GET /api/v1/status`.
 *
 * Không cần xác thực, và trả về những thứ giao diện phải biết để nói ĐÚNG với
 * người dùng: đang chạy model nào, Google SSO đã cấu hình chưa, và quan trọng
 * nhất là agent đang điều khiển cánh tay thật hay bản giả lập. */

import { API_BASE } from "./config";

export interface AgentStatus {
  status: string;
  llm_provider: string;
  model: string;
  app_env: string;
  google_sso_configured: boolean;
  /** `"edge"` = MCP thật. `"mock"` = MockEdgeTransport, không có cánh tay nào. */
  robot_transport: "edge" | "mock";
}

/** Trả `null` khi không hỏi được — chỗ gọi tự quyết định im lặng hay báo.
 *
 * KHÔNG mặc định thành `"edge"` khi lỗi: đoán rằng đang có robot thật là đoán
 * theo hướng nguy hiểm. Không biết thì không khẳng định gì cả. */
export async function fetchAgentStatus(): Promise<AgentStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/status`);
    if (!res.ok) return null;
    return (await res.json()) as AgentStatus;
  } catch {
    return null;
  }
}
