#!/usr/bin/env python
"""Task 0 spike — chốt xem SmolVLA (HuggingFaceVLA/smolvla_libero) có pick-place được
trên libero_object task 7 ("milk") hay không, và đo step/s để quyết định VLA_N_ACTION_STEPS.

Chạy: conda activate lerobot_arm && python scripts/spike_policy.py
"""

import os
import time

import numpy as np
import torch

from lerobot.envs.configs import LiberoEnv as LiberoEnvConfig
from lerobot.envs.libero import LiberoEnv, _get_suite
from lerobot.envs.utils import preprocess_observation
from lerobot.envs.factory import make_env_pre_post_processors
from lerobot.policies.factory import make_policy, make_pre_post_processors
from lerobot.configs.policies import PreTrainedConfig

def _add_batch_dim(obs: dict) -> dict:
    """LiberoEnv (non-vectorized) trả obs không có batch dim cho robot_state.
    preprocess_observation() chỉ tự thêm batch dim cho pixels/agent_pos, không xử lý
    robot_state lồng nhau -> phải thêm thủ công để khớp shape (B, ...) mà
    LiberoProcessorStep kỳ vọng."""
    out = dict(obs)
    if "robot_state" in out:

        def expand(d):
            return {k: expand(v) if isinstance(v, dict) else np.expand_dims(v, 0) for k, v in d.items()}

        out["robot_state"] = expand(out["robot_state"])
    return out


POLICY_REPO = "HuggingFaceVLA/smolvla_libero"
SUITE = "libero_object"
TASK_ID = 7  # "pick up the milk and place it in the basket"
N_STEPS = 200
# n_action_steps=1 trong config gốc => infer lại mỗi step (chậm trên RTX 3050).
# Set VLA_N_ACTION_STEPS=10 để replay action chunk, chỉ infer 1 lần / 10 step.
N_ACTION_STEPS_OVERRIDE = os.environ.get("VLA_N_ACTION_STEPS")


def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device={device}")

    env_cfg = LiberoEnvConfig(
        task=SUITE,
        task_ids=[TASK_ID],
        obs_type="pixels_agent_pos",
        observation_height=256,
        observation_width=256,
        control_mode="relative",
        fps=20,
    )

    policy_cfg = PreTrainedConfig.from_pretrained(POLICY_REPO)
    policy_cfg.pretrained_path = POLICY_REPO
    policy_cfg.device = device

    print("Loading policy...")
    policy = make_policy(cfg=policy_cfg, env_cfg=env_cfg)
    policy.eval()

    if N_ACTION_STEPS_OVERRIDE is not None:
        n = int(N_ACTION_STEPS_OVERRIDE)
        print(f"Overriding policy.config.n_action_steps -> {n}")
        policy.config.n_action_steps = n

    preprocessor, postprocessor = make_pre_post_processors(
        policy_cfg=policy_cfg,
        pretrained_path=POLICY_REPO,
        preprocessor_overrides={"device_processor": {"device": device}},
    )
    env_preprocessor, env_postprocessor = make_env_pre_post_processors(
        env_cfg=env_cfg, policy_cfg=policy_cfg
    )

    suite = _get_suite(SUITE)
    task = suite.get_task(TASK_ID)
    task_description = task.language
    print(f"task[{TASK_ID}] = {task_description!r}")

    env = LiberoEnv(
        task_suite=suite,
        task_id=TASK_ID,
        task_suite_name=SUITE,
        obs_type="pixels_agent_pos",
        observation_height=256,
        observation_width=256,
        control_mode="relative",
        control_freq=20,
    )

    observation, _info = env.reset()
    policy.reset()

    t0 = time.time()
    success = False
    for i in range(N_STEPS):
        obs = preprocess_observation(_add_batch_dim(observation))
        obs["task"] = [task_description]
        obs = env_preprocessor(obs)
        obs = preprocessor(obs)

        with torch.inference_mode():
            action = policy.select_action(obs)
        action = postprocessor(action)
        action_numpy = action.to("cpu").numpy()[0]

        observation, _reward, terminated, _truncated, info = env.step(action_numpy)
        success = success or bool(info.get("is_success", False))

        if (i + 1) % 20 == 0:
            elapsed = time.time() - t0
            print(f"step {i + 1}/{N_STEPS} | success={success} | {(i + 1) / elapsed:.2f} step/s")

        if terminated and success:
            break

    elapsed = time.time() - t0
    n_done = i + 1
    print("---")
    print(f"steps run: {n_done}")
    print(f"success (check_success): {success}")
    print(f"elapsed: {elapsed:.1f}s | {n_done / elapsed:.2f} step/s")

    env.close()


if __name__ == "__main__":
    main()
