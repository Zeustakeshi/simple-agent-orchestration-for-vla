/* Từ vựng hiển thị cho tool call — dùng chung giữa agent trace, tool card và
   timeline P09.
 *
 * Trước đây các bảng này nằm riêng tư trong `components/chat/ToolCard.tsx`, nên
 * `components/logs/TimelineView.tsx` đành in `tool_name` thô (`take_action`)
 * cho người dùng đọc. Đặt ở `lib/` để chỗ nào cũng lấy được mà không phải kéo
 * theo một component chat.
 *
 * Mọi hàm ở đây THUẦN và chỉ đọc những trường backend thật sự trả về — §13.3
 * cấm client tự suy diễn. Không hàm nào ở đây được chạm tới nội dung token hay
 * suy luận của model. */

import {
  Camera, Cpu, Zap, OctagonX, Home, ShieldCheck, Activity,
  Clock, SearchCheck, RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { ToolCall } from "@/stores";
import { errorText } from "@/lib/errors";

/* Hai bộ tên tool cùng tồn tại ở đây một cách có chủ ý.
   Bộ dưới (`capture`, `check_status`, ...) là tool MCP thật của `edge_vla`
   trong dự án này — xem `edge_vla/server.py`. Bộ trên là tên của bản UI gốc,
   giữ lại để dữ liệu mẫu ở các trang Nhật ký/Dashboard vẫn đọc ra tiếng Việt
   thay vì phơi tên kỹ thuật. */
export const TOOL_ICON: Record<string, LucideIcon> = {
  // edge_vla (mvp_vla)
  get_robot_state: Cpu,
  capture: Camera,
  take_action: Zap,
  check_status: Clock,
  check_success: SearchCheck,
  go_home: Home,
  abort: OctagonX,
  reset_episode: RotateCcw,

  // dữ liệu mẫu của bản UI gốc
  capture_tool: Camera,
  stop_robot: OctagonX,
  reset_error: ShieldCheck,
  health_check: Activity,
};

/** Nhãn tiếng Việt, lấy nguyên từ `TOOL_META` của giao diện cũ để người đang
    dùng bản trước không phải học lại tên gọi nào. */
export const TOOL_LABEL: Record<string, string> = {
  // edge_vla (mvp_vla)
  get_robot_state: "Kiểm tra trạng thái robot",
  capture: "Chụp ảnh camera",
  take_action: "Thực hiện thao tác",
  check_status: "Theo dõi tiến độ",
  check_success: "Kiểm tra kết quả",
  go_home: "Về vị trí home",
  abort: "Dừng thao tác",
  reset_episode: "Đặt lại scene",

  // dữ liệu mẫu của bản UI gốc
  capture_tool: "Chụp ảnh quan sát",
  stop_robot: "Dừng robot",
  reset_error: "Xoá cờ lỗi",
  health_check: "Kiểm tra thiết bị",
};

/** Biểu tượng dùng khi tool không có trong bảng.

    Export dưới dạng HẰNG chứ không phải hàm `toolIcon(name)`: gọi một hàm trả
    về component ngay trong render bị lint coi là "tạo component lúc render".
    Chỗ dùng tra bảng trực tiếp — `TOOL_ICON[name] ?? DEFAULT_TOOL_ICON`. */
export const DEFAULT_TOOL_ICON: LucideIcon = Cpu;

/** Tên tiếng Việt của tool. Tool lạ thì trả về nguyên tên kỹ thuật — thà hiện
    `some_new_tool` còn hơn nuốt mất một hành động đã thực sự xảy ra. */
export function toolLabel(toolName: string): string {
  return TOOL_LABEL[toolName] ?? toolName;
}

/** `get_task_status` là vòng lặp thăm dò nội bộ của Cloud: nó đã hiện thành
    thanh tiến độ episode, nên không được thành một dòng riêng (P04 §4).

    Phải lọc từ lúc DỰNG danh sách chứ không phải để component con trả `null` —
    nếu không, số đếm "Đã xong N bước" và phép tính thời lượng vẫn tính nó. */
export function isTraceHiddenTool(toolName: string): boolean {
  return toolName === "get_task_status";
}

/** Tóm tắt tham số cho dòng thu gọn — không có chain-of-thought. */
export function toolArgSummary(call: ToolCall): string {
  const args = call.arguments ?? {};
  // `subgoal` là tên tham số của `take_action` trong edge_vla; `instruction` là
  // tên bản gốc dùng. Đọc cả hai để cùng một hàm phục vụ được dữ liệu thật lẫn
  // dữ liệu mẫu.
  if (typeof args.subgoal === "string") return args.subgoal;
  if (typeof args.instruction === "string") return args.instruction;
  if (Array.isArray(args.cameras)) return args.cameras.join(" + ");
  const keys = Object.keys(args);
  return keys.length === 0 ? "" : keys.map((k) => `${k}: ${String(args[k])}`).join(" · ");
}

/* Tên camera KHÔNG kèm chữ "camera": nó được thêm đúng một lần ở câu bao ngoài.
   Để "camera trên"/"camera cổ tay" ở đây thì hai camera ghép lại thành "Chụp
   ảnh camera trên và camera cổ tay" — lặp thừa, đọc lúng túng. */
const CAMERA_NAME: Record<string, string> = {
  top: "trên",
  wrist: "cổ tay",
};

/** Một câu mô tả HÀNH ĐỘNG cụ thể, kèm tham số thật.
 *
 * Đây là thứ tạo khác biệt giữa "Đang quan sát" — giống hệt nhau ở mọi lượt
 * chat — và "Chụp ảnh camera trên và cổ tay", nói đúng việc agent vừa làm với
 * yêu cầu NÀY.
 *
 * Mọi nhánh chỉ đọc `call.arguments`. Không suy ra ý định, không đoán kết quả,
 * không tóm tắt lại suy luận của model (§13.2, §13.3).
 *
 * KHÔNG cắt chuỗi ở đây: composer cho tới 8000 ký tự nên instruction có thể rất
 * dài, nhưng cắt bằng JS thì `title` cũng mất theo. Chỗ gọi dùng CSS `truncate`
 * và đặt `title` bằng chính chuỗi đầy đủ này. */
export function describeToolCall(call: ToolCall): string {
  const args = call.arguments ?? {};

  if (call.tool_name === "capture") return TOOL_LABEL.capture;

  if (call.tool_name === "capture_tool") {
    const cameras = Array.isArray(args.cameras)
      ? args.cameras.filter((c): c is string => typeof c === "string")
      : [];
    if (cameras.length === 0) return TOOL_LABEL.capture_tool;
    // Giá trị lạ giữ nguyên: chào một camera tên khác còn hơn im lặng bỏ qua.
    return `Chụp ảnh camera ${cameras.map((c) => CAMERA_NAME[c] ?? c).join(" và ")}`;
  }

  if (call.tool_name === "take_action") {
    const raw = typeof args.subgoal === "string" ? args.subgoal : args.instruction;
    const instruction = typeof raw === "string" ? raw.trim() : "";
    if (instruction) return `Thực thi “${instruction}”`;
  }

  const label = toolLabel(call.tool_name);
  /* `trim()` bắt buộc: tham số toàn khoảng trắng vẫn là chuỗi "truthy", không
     cắt thì nhãn ra "Thực thi hành động ·   " với dấu chấm giữa lơ lửng. */
  const summary = toolArgSummary(call).trim();
  return summary ? `${label} · ${summary}` : label;
}

/* ------------------------------------------------------ kết quả từ edge_vla */

/** Câu tiếng Việt cho `status` mà `edge_vla/controller.py` trả về.
 *
 * Chuyển nguyên từ `describeStatus` của giao diện cũ. Lý do giữ lại: `status`
 * là một tập ĐÓNG do edge định nghĩa, và mỗi giá trị mang một hệ quả vận hành
 * khác nhau mà chữ in hoa không nói ra được — "FAILED_MAX_RETRY" không cho biết
 * cánh tay hiện đang ở đâu, còn "tay đã lùi về vị trí an toàn" thì có.
 *
 * Chỉ đọc `status`, `step`, `success`, `reason` — đúng những trường edge trả về. */
export function describeEdgeStatus(result: Record<string, unknown> | undefined): string {
  const r = result ?? {};
  const status = typeof r.status === "string" ? r.status : "";
  const step = typeof r.step === "number" ? ` (bước ${r.step})` : "";
  const reason = typeof r.reason === "string" && r.reason ? `: ${r.reason}` : "";

  switch (status) {
    case "RUNNING":
      return `Đang thực hiện...${step}`;
    case "DONE":
      return r.success === true
        ? "Hoàn thành, đã thành công"
        : "Xong nhưng chưa đạt yêu cầu — agent đang xem lại ảnh";
    case "FAILED_MAX_RETRY":
      return "Thử nhiều lần vẫn chưa được, tay đã lùi về vị trí an toàn";
    case "SAFETY_STOP":
      return `Dừng khẩn cấp vì lý do an toàn${reason}`;
    case "TIMEOUT":
      return "Hết thời gian chờ phản hồi";
    case "ABORTED":
      return "Đã hủy thao tác";
    case "ROBOT_BUSY":
      return "Robot đang bận với thao tác khác";
    default:
      return status || "Đã xử lý xong";
  }
}

/* ------------------------------------------- tường thuật theo thời gian thực */

/** Số bước tối đa / thời gian chờ, đọc từ tham số tool nếu có. */
function argNumber(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Câu mô tả việc tool ĐANG làm, ở thì hiện tại tiếp diễn.
 *
 * Chuyển nguyên từ nhánh `call` của `TOOL_META` trong giao diện cũ. Đây là thứ
 * làm cho việc chờ đợi có nghĩa: "Đang chụp ảnh hiện trường..." nói ra điều gì
 * đang diễn ra, còn `capture` thì không.
 *
 * Chỉ đọc `call.arguments` — không đoán ý định, không tóm tắt suy luận (§13.3). */
function describeToolRunning(call: ToolCall): string {
  const args = call.arguments ?? {};

  switch (call.tool_name) {
    case "get_robot_state":
      return "Đang kiểm tra robot đang rảnh hay bận...";
    case "capture":
      return "Đang chụp ảnh hiện trường...";
    case "take_action": {
      const raw = typeof args.subgoal === "string" ? args.subgoal : args.instruction;
      const subgoal = typeof raw === "string" ? raw.trim() : "";
      const k = argNumber(args, "k");
      return `Bắt đầu: “${subgoal || "..."}”${k !== null ? ` (tối đa ${k} bước)` : ""}`;
    }
    case "check_status": {
      const wait = argNumber(args, "wait_s");
      return `Đang chờ cập nhật${wait !== null ? ` (tối đa ${wait}s)` : ""}...`;
    }
    case "check_success":
      return "Đang kiểm tra đã hoàn thành hay chưa...";
    case "go_home":
      return "Đang đưa tay robot về vị trí home...";
    case "abort":
      return "Đang dừng thao tác hiện tại...";
    case "reset_episode":
      return "Đang đặt lại scene mô phỏng...";
    default:
      return describeToolCall(call);
  }
}

/** Câu mô tả việc tool ĐÃ làm xong, đọc từ kết quả thật.
 *
 * Chuyển nguyên từ nhánh `result` của `TOOL_META` cũ. Quan trọng hơn vẻ ngoài:
 * `take_action` trả về ngay lập tức vì nó CHẠY NỀN — "Đã bắt đầu, đang theo dõi
 * tiến độ" nói đúng điều đó, còn một dấu tích xanh trơ trọi thì đọc ra là "đã
 * đặt xong hộp sữa", trong khi cánh tay còn chưa nhúc nhích. */
function describeToolResult(call: ToolCall): string {
  const result = call.result ?? {};

  switch (call.tool_name) {
    case "get_robot_state":
      return result.busy === true ? "Robot đang bận với một thao tác khác" : "Robot đang rảnh, sẵn sàng nhận lệnh";
    case "capture":
      return "Đã chụp ảnh xong";
    case "take_action":
      return "Đã bắt đầu — đang theo dõi tiến độ...";
    case "check_status":
      return describeEdgeStatus(result);
    case "check_success":
      return result.success === true ? "Đã hoàn thành thành công" : "Chưa đạt yêu cầu";
    case "go_home":
      return "Đã về vị trí home";
    case "abort":
      return "Đã dừng thao tác";
    case "reset_episode":
      return "Đã đặt lại scene";
    default:
      return describeToolCall(call);
  }
}

/** Dòng tường thuật của một tool, ĐỔI THEO trạng thái của nó.
 *
 * Giao diện cũ dựng một thẻ cho mỗi tool rồi VIẾT ĐÈ lên chính nó khi kết quả
 * về: "Đang chụp ảnh hiện trường..." thành "Đã chụp ảnh xong". Đó là thứ làm
 * người dùng đọc được tiến trình như một câu chuyện thay vì một bảng log.
 *
 * Bản gốc của giao diện mới chỉ hiện mô tả LỜI GỌI, không bao giờ đổi — nên
 * mọi kết quả, kể cả "Thử nhiều lần vẫn chưa được", đều bị chôn sau một cú bấm
 * mở rộng. Hàm này trả lại hành vi cũ.
 *
 * Lỗi thì hiện thẳng lý do: lúc hỏng là lúc ít được bắt người dùng đi tìm nhất. */
export function describeToolProgress(call: ToolCall): string {
  switch (call.status) {
    case "PENDING":
    case "RUNNING":
      return describeToolRunning(call);
    case "FAILED":
      return call.error ? errorText(call.error) : "Thất bại";
    case "CANCELLED":
      return "Đã huỷ";
    case "TIMEOUT":
      return "Quá thời gian chờ";
    default:
      return describeToolResult(call);
  }
}
