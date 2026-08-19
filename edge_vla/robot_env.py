"""Robot thật (SO-101/SO-100 follower, hoặc bất kỳ robot nào lerobot hỗ trợ qua
`RobotConfig`) cho Edge VLA: kết nối, đọc observation, gửi action, và các helper
(frames, home position) mà controller/safety dùng.

Không còn ràng buộc EGL/thread như bản mô phỏng MuJoCo — nhưng vẫn phải chạy MỌI thao
tác chạm robot (connect/get_observation/send_action) trong ĐÚNG MỘT worker thread
(xem controller.py) vì serial bus (Feetech) không thread-safe.
"""

from __future__ import annotations

import numpy as np

from lerobot.cameras import CameraConfig, make_cameras_from_configs
from lerobot.motors import MotorNormMode
from lerobot.motors.feetech import MODEL_RESOLUTION
from lerobot.robots import RobotConfig, make_robot_from_config

# Đăng ký các subclass RobotConfig/CameraConfig vào draccus ChoiceRegistry — bắt buộc
# import trước khi gọi RobotConfig.get_choice_class()/CameraConfig.get_choice_class().
from lerobot.robots import so_follower  # noqa: F401
from lerobot.cameras import opencv as _opencv_camera  # noqa: F401

from . import config


def _build_camera_configs() -> dict[str, CameraConfig]:
    cameras: dict[str, CameraConfig] = {}
    for name, cam_cfg in config.ROBOT_CAMERAS.items():
        cam_cfg = dict(cam_cfg)
        cam_type = cam_cfg.pop("type")
        cam_cls = CameraConfig.get_choice_class(cam_type)
        cameras[name] = cam_cls(**cam_cfg)
    return cameras


def _build_robot_config() -> RobotConfig:
    robot_cls = RobotConfig.get_choice_class(config.ROBOT_TYPE)
    kwargs = dict(
        id=config.ROBOT_ID,
        port=config.ROBOT_PORT,
        cameras=_build_camera_configs(),
    )
    if config.ROBOT_MAX_RELATIVE_TARGET is not None:
        kwargs["max_relative_target"] = config.ROBOT_MAX_RELATIVE_TARGET
    return robot_cls(**kwargs)


def _joint_limits_from_calibration(robot) -> dict[str, tuple[float, float]]:
    """Suy ra khoảng vị trí AN TOÀN THẬT (độ với joint arm, 0-100 với gripper) từ file
    calibration đã ghi lúc `robot.calibrate()` — tương đương `jnt_range` mà bản mô
    phỏng MuJoCo có sẵn. Calibration lưu `range_min`/`range_max` dạng encoder tick thô
    (0-4095), phải tự quy đổi theo đúng công thức normalize của FeetechMotorsBus
    (`_normalize`, motors_bus.py) vì `send_action` KHÔNG tự clamp theo range này ở
    norm_mode DEGREES (chỉ RANGE_0_100/RANGE_M100_100 mới tự clamp).

    Trả về {} nếu robot không phải SOFollower-family (không có `bus`/`calibration`) —
    lúc đó safety.check() chỉ còn dựa vào injection file (xem edge_vla/safety.py)."""
    bus = getattr(robot, "bus", None)
    calibration = getattr(robot, "calibration", None)
    if bus is None or not calibration:
        return {}

    limits: dict[str, tuple[float, float]] = {}
    for name, motor in bus.motors.items():
        cal = calibration.get(name)
        if cal is None:
            continue
        if motor.norm_mode == MotorNormMode.DEGREES:
            max_res = MODEL_RESOLUTION[motor.model] - 1
            mid = (cal.range_min + cal.range_max) / 2
            lo = (cal.range_min - mid) * 360 / max_res
            hi = (cal.range_max - mid) * 360 / max_res
        elif motor.norm_mode == MotorNormMode.RANGE_0_100:
            lo, hi = 0.0, 100.0
        elif motor.norm_mode == MotorNormMode.RANGE_M100_100:
            lo, hi = -100.0, 100.0
        else:
            continue
        limits[f"{name}.pos"] = (min(lo, hi), max(lo, hi))
    return limits


class RobotHandle:
    """Một robot thật + state cần cho controller/safety."""

    def __init__(self):
        self.robot = make_robot_from_config(_build_robot_config())
        self.robot.connect()
        self.camera_names: list[str] = list(config.ROBOT_CAMERAS.keys())

        obs = self.robot.get_observation()
        self.last_obs: dict = obs
        self.home_positions: dict[str, float] = {k: v for k, v in obs.items() if k.endswith(".pos")}
        self.joint_limits: dict[str, tuple[float, float]] = _joint_limits_from_calibration(self.robot)

    # -- lifecycle -----------------------------------------------------
    def step(self, action: dict[str, float]) -> dict:
        sent = self.robot.send_action(action)
        self.last_obs = self.robot.get_observation()
        return sent

    def refresh_observation(self) -> dict:
        self.last_obs = self.robot.get_observation()
        return self.last_obs

    # -- observation helpers ---------------------------------------------
    def frames(self) -> dict[str, np.ndarray]:
        """Ảnh mới nhất từ mọi camera cấu hình trong config.yaml (đọc từ last_obs)."""
        return {name: self.last_obs[name] for name in self.camera_names if name in self.last_obs}

    def joint_state(self) -> dict:
        """Dùng cho safety.check() — vị trí joint hiện tại, không có force/velocity
        feedback (Feetech bus chỉ đọc Present_Position)."""
        return {k: v for k, v in self.last_obs.items() if k.endswith(".pos")}

    def close(self):
        if self.robot.is_connected:
            self.robot.disconnect()
