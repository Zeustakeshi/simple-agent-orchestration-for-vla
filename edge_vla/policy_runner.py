"""Load SmolVLA (HuggingFaceVLA/smolvla_libero) MỘT LẦN lúc khởi động, dùng lại cho
mọi task. Chuỗi inference đúng theo Task 0 spike / lerobot_eval.py:263-290."""

from __future__ import annotations

import numpy as np
import torch

from lerobot.configs.policies import PreTrainedConfig
from lerobot.envs.configs import LiberoEnv as LiberoEnvConfig
from lerobot.envs.factory import make_env_pre_post_processors
from lerobot.envs.utils import preprocess_observation
from lerobot.policies.factory import make_policy, make_pre_post_processors

from . import config


def _add_batch_dim(obs: dict) -> dict:
    """LiberoEnv (non-vectorized) trả obs không có batch dim cho robot_state.
    preprocess_observation() chỉ tự thêm batch dim cho pixels/agent_pos -> phải
    thêm thủ công để khớp shape (B, ...) mà LiberoProcessorStep kỳ vọng."""
    out = dict(obs)
    if "robot_state" in out:

        def expand(d):
            return {k: expand(v) if isinstance(v, dict) else np.expand_dims(v, 0) for k, v in d.items()}

        out["robot_state"] = expand(out["robot_state"])
    return out


class PolicyRunner:
    def __init__(self):
        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device

        env_cfg = LiberoEnvConfig(
            task=config.SUITE,
            obs_type="pixels_agent_pos",
            observation_height=config.OBS_HEIGHT,
            observation_width=config.OBS_WIDTH,
            control_mode=config.CONTROL_MODE,
            fps=config.CONTROL_FREQ,
        )

        policy_cfg = PreTrainedConfig.from_pretrained(config.POLICY_REPO)
        policy_cfg.pretrained_path = config.POLICY_REPO
        policy_cfg.device = device

        self.policy = make_policy(cfg=policy_cfg, env_cfg=env_cfg)
        self.policy.eval()
        self.policy.config.n_action_steps = config.N_ACTION_STEPS

        self.preprocessor, self.postprocessor = make_pre_post_processors(
            policy_cfg=policy_cfg,
            pretrained_path=config.POLICY_REPO,
            preprocessor_overrides={"device_processor": {"device": device}},
        )
        self.env_preprocessor, self.env_postprocessor = make_env_pre_post_processors(
            env_cfg=env_cfg, policy_cfg=policy_cfg
        )

    def reset(self):
        """Xoá action queue nội bộ của policy — bắt buộc gọi trước mỗi take_action
        mới (chunk cũ không còn hợp lệ cho task/scene mới)."""
        self.policy.reset()

    def act(self, observation: dict, task_text: str) -> np.ndarray:
        obs = preprocess_observation(_add_batch_dim(observation))
        obs["task"] = [task_text]
        obs = self.env_preprocessor(obs)
        obs = self.preprocessor(obs)

        with torch.inference_mode():
            action = self.policy.select_action(obs)
        action = self.postprocessor(action)
        return action.to("cpu").numpy()[0]
