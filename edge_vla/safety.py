"""Safety check chạy MỖI STEP, độc lập mạng — không phụ thuộc LLM/agent còn sống
hay không. Vi phạm -> controller gọi emergency_stop() ngay, không chờ hết K, không
tự retry."""

from __future__ import annotations

import os

import numpy as np

from . import config


def check(mj_state: dict) -> tuple[bool, str | None]:
    force = mj_state["actuator_force"]
    if np.max(np.abs(force)) > config.SAFETY_MAX_ACTUATOR_FORCE:
        return False, "servo load"

    joint_vel = mj_state["joint_vel"]
    if np.max(np.abs(joint_vel)) > config.SAFETY_MAX_JOINT_VEL:
        return False, "joint velocity"

    joint_pos = mj_state["joint_pos"]
    jnt_range = mj_state["jnt_range"]
    below = joint_pos < jnt_range[:, 0]
    above = joint_pos > jnt_range[:, 1]
    if np.any(below) or np.any(above):
        return False, "joint out of range"

    if os.path.exists(config.SAFETY_INJECT_FILE):
        return False, "manual safety injection"

    return True, None
