"""Safety check chạy MỖI STEP, độc lập mạng — không phụ thuộc LLM/agent còn sống hay
không. Vi phạm -> controller gọi emergency_stop() ngay, không chờ hết K, không tự
retry.

QUAN TRỌNG: SO-101 chạy position-mode servo (Feetech) — gửi goal position là gửi một
ĐÍCH ĐẾN, không phải dịch chuyển tức thời như state trong bản mô phỏng MuJoCo. Servo tự
chạy tới đích theo tốc độ/lực riêng (PID nội bộ: position_p/i/d_coefficient). Vì vậy
"target cách xa vị trí hiện tại" (vd step đầu tiên robot vươn tới vật, cách hàng chục
độ) là BÌNH THƯỜNG, không phải dấu hiệu nguy hiểm — khác hẳn bản mô phỏng nơi action là
dịch chuyển tức thời. `lerobot-rollout` (CLI gốc) không hề có kiểu check "step quá lớn"
nào cho robot thật; ta cũng không nên tự đặt ra, kẻo chặn oan chuyển động hợp lệ.

Còn 2 lớp an toàn thật sự có ý nghĩa cho robot thật:
  1. `joint_limits` — khoảng vị trí AN TOÀN THẬT suy ra từ calibration đã ghi lúc
     `robot.calibrate()` (xem `robot_env._joint_limits_from_calibration`) — chặn
     ĐÍCH ĐẾN nằm ngoài phạm vi vật lý đã đo, không liên quan gì tới tốc độ/biên độ
     mỗi lệnh nên không gây chuyển động "giật/nhích".
  2. Injection file để demo/test SAFETY_STOP thủ công.
"""

from __future__ import annotations

import os

from . import config

_LIMIT_TOLERANCE_DEG = 1.0


def check(
    action: dict[str, float],
    current_pos: dict[str, float],
    joint_limits: dict[str, tuple[float, float]] | None = None,
) -> tuple[bool, str | None]:
    joint_limits = joint_limits or {}
    for key, target in action.items():
        if not key.endswith(".pos"):
            continue

        limits = joint_limits.get(key) if config.SAFETY_CHECK_JOINT_LIMITS else None
        if limits is not None:
            lo, hi = limits
            if target < lo - _LIMIT_TOLERANCE_DEG or target > hi + _LIMIT_TOLERANCE_DEG:
                return False, f"{key}={target:.1f} vượt khoảng an toàn calibration [{lo:.1f}, {hi:.1f}]"

    if os.path.exists(config.SAFETY_INJECT_FILE):
        return False, "manual safety injection"

    return True, None
