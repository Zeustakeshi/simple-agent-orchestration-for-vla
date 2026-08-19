"""Hard limits + config robot/camera/policy cho Edge VLA.

Hard limits (MAX_RETRY, MAX_POLL, WAIT_CLAMP, MAX_K, TASK_TIMEOUT_S) là hằng số Python
KHÔNG đọc từ config.yaml — đúng kiến trúc "Edge giữ giới hạn cứng", agent/LLM không
được vượt qua dù truyền giá trị khác. config.yaml chỉ chứa thông số kết nối phần cứng
(port robot, port camera, đường dẫn policy...) do người vận hành chỉnh, không phải
LLM.
"""

import os
from pathlib import Path

import yaml

# --- Hard limits (agent không được vượt qua) ---
# MAX_RETRY/MAX_POLL nới hơn bản mô phỏng: robot thật di chuyển vật lý thật (không
# teleport), một pick-place thường cần NHIỀU lượt take_action liên tiếp cùng subgoal
# để tiến triển (không phải retry do thất bại — không còn ground-truth để phân biệt
# 2 trường hợp này) + agent cần poll lâu hơn mỗi lượt để đợi robot di chuyển xong.
MAX_RETRY = 8
# TASK_TIMEOUT_S x50 theo yêu cầu — robot đang bị cắt ngang giữa chừng vì hết giờ
# trước khi kịp chạy xong k step. Nguyên nhân thật có thể là mỗi step (policy
# inference + serial IO) đang chậm hơn dự tính (vd torch.cuda.is_available() == False
# nên policy chạy CPU dù config.yaml đặt device: cuda) — NÊN KIỂM TRA lại thay vì chỉ
# nới timeout, vì 9000s/lượt take_action là rất dài cho một pick-place.
TASK_TIMEOUT_S = 180 * 50  # 9000s ≈ 2h30 — NGÂN SÁCH TỔNG cho một take_action.
# WAIT_CLAMP là trần cho MỖI LẦN chờ (không phải tổng) — để WAIT_CLAMP cao bằng
# TASK_TIMEOUT_S khiến 1 lần check_status có thể block hàng giờ, agent trông như
# "đứng hình" (đây chính là điều bạn vừa thấy). Giữ trần mỗi lần chờ vừa phải, và
# tăng MAX_POLL đủ lớn để (MAX_POLL x trần chờ) >= TASK_TIMEOUT_S — vẫn đủ ngân sách
# tổng nhưng agent poll đều đặn, thấy tiến độ thường xuyên thay vì im lặng.
WAIT_CLAMP = (1, 180)
MAX_POLL = 60  # 60 x 180s = 10800s >= TASK_TIMEOUT_S
MAX_K = 200

# --- Load config.yaml ---
_DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"
_CONFIG_PATH = Path(os.environ.get("VLA_CONFIG", _DEFAULT_CONFIG_PATH))

with open(_CONFIG_PATH, encoding="utf-8") as f:
    _cfg = yaml.safe_load(f) or {}

# --- Robot ---
_robot = _cfg.get("robot", {})
ROBOT_TYPE = _robot["type"]
ROBOT_PORT = _robot["port"]
ROBOT_ID = _robot.get("id", "follower_arm")
_max_rel_target = _robot.get("max_relative_target")
# ensure_safe_goal_position() trong lerobot check isinstance(x, float) chặt — YAML
# parse số nguyên (vd `15`) thành int, phải ép kiểu ở đây nếu không sẽ TypeError khi
# gửi action đầu tiên cho robot (không phải lỗi kết nối).
ROBOT_MAX_RELATIVE_TARGET = float(_max_rel_target) if _max_rel_target is not None else None
ROBOT_CAMERAS: dict = _robot.get("cameras", {})

# --- Policy ---
_policy = _cfg.get("policy", {})
POLICY_PATH = _policy["path"]
POLICY_DEVICE = _policy.get("device", "cuda")
POLICY_EMPTY_CAMERAS = _policy.get("empty_cameras")
# None = KHÔNG override — dùng đúng n_action_steps/chunk_size đã train trong
# checkpoint (đọc từ config.json của policy). Đừng đặt số ở đây trừ khi bạn cố ý muốn
# đổi tần suất re-plan; ép về một số nhỏ hơn chunk_size gốc sẽ khiến robot LUÔN chỉ
# chạy đoạn ĐẦU của mỗi quỹ đạo (thường là đoạn khởi động nhẹ) rồi infer lại, không
# bao giờ tới đoạn giữa/cuối quỹ đạo nơi có động tác with/gắp quyết đoán.
_n_action_steps_raw = os.environ.get("VLA_N_ACTION_STEPS", _policy.get("n_action_steps"))
N_ACTION_STEPS = int(_n_action_steps_raw) if _n_action_steps_raw is not None else None

# --- Task / rename map ---
DEFAULT_TASK = _cfg.get("task", {}).get("default", "")
RENAME_MAP: dict = _cfg.get("rename_map", {})

# --- Control ---
CONTROL_FREQ = _cfg.get("control", {}).get("fps", 30)

# --- Safety thresholds (độc lập mạng, chạy mỗi step) ---
_safety = _cfg.get("safety", {})
SAFETY_MAX_STEP_DEG = float(_safety.get("max_step_deg", 60.0))
SAFETY_INJECT_FILE = _safety.get("inject_file", "/tmp/vla_inject_safety")
# Công tắc TẠM THỜI để debug — tắt thì mất luôn ranh giới an toàn thật suy ra từ
# calibration (robot_env._joint_limits_from_calibration). BẬT LẠI sau khi xác nhận
# hành vi robot, đừng để false khi chạy không giám sát.
SAFETY_CHECK_JOINT_LIMITS = bool(_safety.get("check_joint_limits", True))

# --- Ports ---
MCP_PORT = int(os.environ.get("VLA_MCP_PORT", _cfg.get("mcp", {}).get("port", 8931)))
