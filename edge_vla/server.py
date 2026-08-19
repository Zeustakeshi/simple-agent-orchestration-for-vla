"""MCP server (FastMCP, transport streamable-http) cho Edge VLA.

Chạy `uvicorn`/MCP trong thread nền; main thread giữ cửa sổ `cv2.imshow` (bắt buộc
theo OpenCV) qua `viewer.run_forever()`. `GET /mjpeg` được đăng ký làm custom route
trên CHÍNH app FastMCP đang serve (không tạo FastAPI app riêng) để tránh phải quản lý
lifespan mount lồng nhau.
"""

from __future__ import annotations

import logging
import threading

from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import StreamingResponse

from . import config
from .controller import Controller
from .task_store import TaskStore
from .viewer import Viewer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

mcp = FastMCP("mvp-vla-edge", host="0.0.0.0", port=config.MCP_PORT)

viewer = Viewer()
store = TaskStore()
controller = Controller(viewer, store)


@mcp.tool()
def get_robot_state() -> dict:
    """SYNC, non-blocking. Trả state hiện tại của edge (busy, retry_count, robot đã
    kết nối chưa, vị trí joint hiện tại, danh sách camera). Gọi tool này TRƯỚC khi lập
    kế hoạch."""
    return controller.get_robot_state()


@mcp.tool()
def capture() -> dict:
    """SYNC, non-blocking. Trả ảnh agentview + wrist gần nhất (base64 JPEG) từ frame
    buffer đã publish — KHÔNG render lại. Gọi cùng get_robot_state() trước khi lập kế
    hoạch, và bất cứ khi nào cần "xem ảnh" để quyết định retry/replan."""
    return controller.capture()


@mcp.tool()
def take_action(subgoal: str, k: int) -> dict:
    """ASYNC — trả về NGAY (~10ms), KHÔNG chờ robot chạy xong.

    Chạy robot tối đa k step (hard-clamped [1, 200]) hướng tới `subgoal`. `subgoal`
    được gửi THẲNG cho policy làm task text (giống `--task="..."` của lerobot-rollout)
    — mô tả càng cụ thể càng tốt. Nếu robot đang busy -> trả {status: ROBOT_BUSY} và
    KHÔNG spawn task mới (gọi check_status của task hiện tại trước). Sau khi gọi, PHẢI
    poll check_status(task_id, wait_s) với wait_s tăng dần (gợi ý 3 -> 5 -> 8) cho tới
    khi status khác RUNNING — KHÔNG gọi take_action mới trong lúc chưa
    DONE/FAILED/SAFETY_STOP/TIMEOUT/ABORTED.

    Robot thật không có ground-truth thành công — kết quả DONE luôn có success=None,
    agent PHẢI xem ảnh trả về để tự đánh giá. Nếu gọi take_action với CÙNG subgoal
    nhiều lần liên tiếp (agent tự retry) và chạm MAX_RETRY, edge tự động recovery (mở
    gripper + về home) và trả FAILED_MAX_RETRY thay vì chạy tiếp.

    Args:
        subgoal: mô tả tự nhiên (tiếng Anh) việc cần làm — dùng trực tiếp làm task
            text cho policy.
        k: số step tối đa cho lượt chạy này (gợi ý 40-80 cho pick-place).
    """
    return controller.take_action(subgoal, k)


@mcp.tool()
async def check_status(task_id: str, wait_s: float) -> dict:
    """ASYNC, THỰC SỰ BLOCKING đúng wait_s (clamp [1, 15]s) hoặc thoát sớm nếu task
    đã xong. Đây là cách duy nhất để biết take_action đã DONE hay chưa — poll tối đa
    8 lần cho một task_id, lần thứ 9 tự động abort + trả TIMEOUT.

    Trạng thái trả về và cách xử lý:
      - RUNNING: chưa xong, poll lại với wait_s lớn hơn.
      - DONE + success=true: gọi go_home() rồi báo kết quả cho user.
      - DONE + success=false: XEM ẢNH trong response rồi tự quyết định gọi lại
        take_action (retry/đổi cách) hay dừng.
      - FAILED_MAX_RETRY: edge đã tự mở gripper + lùi + về home (safe_at_home=true).
        HỎI USER, không tự retry.
      - SAFETY_STOP: dừng khẩn cấp giữa chừng. Báo user NGAY, CẤM retry.
      - TIMEOUT / ABORTED: tự dừng do hết poll hoặc bị abort.
    """
    return await controller.check_status(task_id, wait_s)


@mcp.tool()
def check_success() -> dict:
    """SYNC, non-blocking. Robot thật KHÔNG có ground-truth thành công (không còn
    predicate BDDL như bản mô phỏng) — luôn trả success=None. Dùng capture() rồi tự
    đánh giá qua ảnh."""
    return controller.check_success()


@mcp.tool()
def go_home() -> dict:
    """SYNC, blocking (~1-2s). Nội suy từng joint về vị trí lúc edge server kết nối
    robot (home_positions). Gọi sau khi DONE để dọn dẹp trước lượt tiếp theo."""
    return controller.go_home()


@mcp.tool()
def abort(task_id: str) -> dict:
    """SYNC, non-blocking. Bật cờ dừng — task nền đang chạy sẽ thoát trong ≤1 step."""
    return controller.abort(task_id)


@mcp.tool()
def reset_episode() -> dict:
    """SYNC, blocking (~1-2s). Tool NGOÀI kiến trúc gốc: abort task hiện tại (nếu có),
    đưa robot về home, và xoá state retry/subgoal đang theo dõi — dùng để "làm mới"
    phiên làm việc mà không cần khởi động lại edge server. Robot thật không có scene
    để reset như bản mô phỏng."""
    return controller.reset_episode()


@mcp.custom_route("/mjpeg", methods=["GET"])
async def mjpeg(request: Request) -> StreamingResponse:
    return StreamingResponse(
        viewer.mjpeg_generator(), media_type="multipart/x-mixed-replace; boundary=frame"
    )


def main() -> None:
    server_thread = threading.Thread(
        target=mcp.run, kwargs={"transport": "streamable-http"}, daemon=True
    )
    server_thread.start()
    logger.info(f"Edge MCP server listening on :{config.MCP_PORT} (streamable-http) + /mjpeg")
    viewer.run_forever()  # main thread — cv2.imshow bắt buộc


if __name__ == "__main__":
    main()
