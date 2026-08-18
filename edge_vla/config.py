"""Hard limits + đường dẫn cho Edge VLA. KHÔNG cho LLM chỉnh các giá trị này —
đây là ranh giới cứng nằm trong code, đúng kiến trúc "Edge giữ giới hạn cứng"."""

import os

# --- Hard limits (agent không được vượt qua) ---
MAX_RETRY = 3
MAX_POLL = 8
WAIT_CLAMP = (1, 15)
MAX_K = 200
TASK_TIMEOUT_S = 180

# --- Scenario ---
SUITE = "libero_object"
POLICY_REPO = "HuggingFaceVLA/smolvla_libero"

# n_action_steps=1 mặc định trong config.json của policy -> infer lại mỗi step.
# Task 0 spike đo được ~3.7 step/s ở n_action_steps=1 (< 5 step/s ngưỡng chấp nhận),
# ~21-25 step/s ở n_action_steps=10 (replay action chunk, chỉ infer 1 lần / 10 step).
N_ACTION_STEPS = int(os.environ.get("VLA_N_ACTION_STEPS", "10"))

# --- Observation / control ---
OBS_HEIGHT = 256
OBS_WIDTH = 256
CONTROL_FREQ = 20
CONTROL_MODE = "relative"

# --- Safety thresholds (độc lập mạng, chạy mỗi step) ---
# Đo bằng random-action stress test trên libero_object task 7: actuator_force đỉnh
# ~80, joint qvel đỉnh ~2.3 rad/s. Đặt ngưỡng cao hơn hẳn vận hành bình thường của
# policy để tránh false positive, nhưng đủ thấp để bắt runaway thật.
SAFETY_MAX_ACTUATOR_FORCE = 150.0
SAFETY_MAX_JOINT_VEL = 6.0
SAFETY_INJECT_FILE = "/tmp/vla_inject_safety"

# --- Ports ---
MCP_PORT = int(os.environ.get("VLA_MCP_PORT", "8931"))
