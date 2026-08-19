import type { Robot } from "@/stores";
import { apiClient } from "./client";
import { USE_MOCK, CHAT_LIVE } from "./config";
import { postGoHome } from "./mvp-chat";
import { fetchMockRobots, fetchMockRobotStats, stopMockRobot } from "@/lib/mock/robots";

export async function fetchRobots(): Promise<Robot[]> {
  if (USE_MOCK) return fetchMockRobots();
  /* KHÔNG nuốt lỗi rồi trả `mockRobots`.
     Bản trước có `catch { return mockRobots }`, nghĩa là backend chết thì giao
     diện vẫn vẽ ra một cánh tay IDLE/ONLINE khoẻ mạnh. Với một ứng dụng điều
     khiển robot, hiện trạng thái giả còn nguy hiểm hơn hiện lỗi: người dùng có
     thể bấm lệnh dựa trên một tình trạng không có thật. Ném lỗi lên để chỗ gọi
     hiện đúng trạng thái mất kết nối. */
  return apiClient.get<Robot[]>("/api/v1/robots");
}

export async function fetchRobot(robotId: string): Promise<Robot | null> {
  if (USE_MOCK) {
    const rows = await fetchMockRobots();
    return rows.find((r) => r.id === robotId) ?? null;
  }
  try {
    return await apiClient.get<Robot>(`/api/v1/robots/${encodeURIComponent(robotId)}`);
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
      return null;
    }
    throw err;
  }
}

/* ---------------------------------------------------- lệnh gửi tới cánh tay
 *
 * Bốn hàm dưới đây gọi thẳng tool của Edge qua Cloud. KHÔNG hàm nào nuốt lỗi:
 * đây là lệnh chạm vào cánh tay thật, và báo thành công khi thực ra không gửi
 * được là kiểu nói dối tệ nhất ở đây. Chỗ gọi bắt lỗi rồi hiện lý do. */

/** Đưa cánh tay về vị trí home an toàn — `POST /go_home` (`server/main.py`),
 *  gọi thẳng tool MCP `go_home`, không qua LLM agent. */
export async function goHomeRobot(robotId: string): Promise<void> {
  if (CHAT_LIVE) {
    await postGoHome();
    return;
  }
  if (USE_MOCK) {
    const { goHomeMockRobot } = await import("@/lib/mock/robots");
    await goHomeMockRobot(robotId);
    return;
  }
  await apiClient.post(`/api/v1/robots/${encodeURIComponent(robotId)}/go-home`);
}

/** Nút dừng của thanh tiêu đề.
 *
 * ⚠️ Ở dự án này nó gọi `/go_home`, KHÔNG phải một E-stop.
 *
 * `edge_vla` có tool MCP `abort`, nhưng `server/main.py` chỉ phơi ra đúng hai
 * đường cho trình duyệt: `/chat` và `/go_home`. `abort` vì thế chỉ agent gọi
 * được, không có đường HTTP nào chạm tới. `go_home` là hành động dừng-được duy
 * nhất mà giao diện với tới: nó cắt ngang thao tác đang chạy và đưa tay về vị
 * trí an toàn.
 *
 * Nút đã được đổi nhãn thành "Về vị trí an toàn" cho khớp (`HaltButton`) — hứa
 * một E-stop tức thời rồi thực hiện một chuyển động chậm về home là kiểu nói
 * dối nguy hiểm nhất mà giao diện này có thể phạm phải.
 *
 * TODO: muốn E-stop thật thì thêm `POST /abort` vào `server/main.py` — dài đúng
 * năm dòng, sao chép nguyên mẫu của `go_home` ở ngay trên nó — rồi trỏ hàm này
 * sang đó và trả lại nhãn "Dừng". */
export async function stopRobot(robotId: string, mode: "GRACEFUL" | "EMERGENCY" = "GRACEFUL"): Promise<void> {
  if (CHAT_LIVE) {
    await postGoHome();
    return;
  }
  if (USE_MOCK) {
    await stopMockRobot(robotId);
    return;
  }
  await apiClient.post(`/api/v1/robots/${encodeURIComponent(robotId)}/stop?mode=${mode}`);
}

/** Xoá cờ lỗi sau khi đã xử lý nguyên nhân. */
export async function resetRobotError(robotId: string): Promise<void> {
  if (USE_MOCK) {
    const { resetMockRobotError } = await import("@/lib/mock/robots");
    await resetMockRobotError(robotId);
    return;
  }
  await apiClient.post(`/api/v1/robots/${encodeURIComponent(robotId)}/reset-error`);
}

export interface RobotHealth {
  ok: boolean;
  data: Record<string, unknown>;
}

/** Sức khoẻ thiết bị, do chính Edge trả về. */
export async function fetchRobotHealth(robotId: string): Promise<RobotHealth | null> {
  if (USE_MOCK) return null;
  try {
    return await apiClient.get<RobotHealth>(`/api/v1/robots/${encodeURIComponent(robotId)}/health`);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- thống kê vận hành */

export interface RunOutcomeCount {
  /** Trạng thái lượt chạy THẬT trong database: COMPLETED / FAILED / RUNNING… */
  status: string;
  count: number;
}

export interface DailyActivity {
  date: string;
  count: number;
}

export interface RobotStats {
  window_days: number;
  total_runs: number;
  /** Số lượt đã kết thúc — mẫu số của `success_rate`. */
  finished_runs: number;
  /** `null` khi chưa lượt nào kết thúc: chưa có gì để tính, không phải 0%. */
  success_rate: number | null;
  avg_duration_s: number | null;
  outcomes: RunOutcomeCount[];
  daily_activity: DailyActivity[];
}

/** Thống kê lượt chạy của một robot — nguồn cho trang Tổng quan.
 *
 * Chế độ mock trả dữ liệu giả cố định (không random) để trang có gì mà xem;
 * chế độ thật gọi Cloud — hiện Cloud CHƯA có route này (lệch OpenAPI), nên
 * lỗi bị nuốt thành `null` và trang tự ẩn khối Thống kê chứ không báo lỗi
 * giả — cần nhóm Cloud bổ sung `GET /robots/{id}/stats` để hết trống. */
export async function fetchRobotStats(robotId: string, days = 14): Promise<RobotStats | null> {
  if (USE_MOCK) return fetchMockRobotStats(robotId, days) as Promise<RobotStats | null>;
  try {
    return await apiClient.get<RobotStats>(
      `/api/v1/robots/${encodeURIComponent(robotId)}/stats?days=${days}`,
    );
  } catch {
    return null;
  }
}
