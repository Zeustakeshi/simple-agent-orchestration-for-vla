"""Load policy (SmolVLA hoặc bất kỳ policy nào lerobot hỗ trợ) MỘT LẦN lúc khởi động,
dùng lại cho mọi task. Tái sử dụng đúng building block mà `lerobot-rollout
--strategy.type=base --inference.type=sync` dùng (`SyncInferenceEngine`,
`make_pre_post_processors`, `build_dataset_frame`) để khớp hành vi CLI thật đã được
kiểm chứng trên robot, thay vì tự viết lại tiền xử lý observation."""

from __future__ import annotations

import torch

from lerobot.configs.policies import PreTrainedConfig
from lerobot.datasets.pipeline_features import aggregate_pipeline_dataset_features, create_initial_features
from lerobot.policies.factory import get_policy_class, make_pre_post_processors
from lerobot.processor import make_default_processors
from lerobot.rollout.inference.sync import SyncInferenceEngine
from lerobot.utils.constants import OBS_STR
from lerobot.utils.feature_utils import build_dataset_frame, combine_feature_dicts, hw_to_dataset_features

from . import config


class PolicyRunner:
    def __init__(self, robot):
        device = config.POLICY_DEVICE if torch.cuda.is_available() else "cpu"
        self.device = device

        policy_cfg = PreTrainedConfig.from_pretrained(config.POLICY_PATH)
        policy_cfg.pretrained_path = config.POLICY_PATH
        policy_cfg.device = device
        if config.POLICY_EMPTY_CAMERAS is not None and hasattr(policy_cfg, "empty_cameras"):
            policy_cfg.empty_cameras = config.POLICY_EMPTY_CAMERAS
        if config.N_ACTION_STEPS is not None:
            policy_cfg.n_action_steps = config.N_ACTION_STEPS
        # None -> giữ nguyên n_action_steps đã train trong checkpoint (không ép về
        # giá trị khác) — xem giải thích trong edge_vla/config.py.

        policy_class = get_policy_class(policy_cfg.type)
        self.policy = policy_class.from_pretrained(policy_cfg.pretrained_path, config=policy_cfg)
        self.policy = self.policy.to(device)
        self.policy.eval()

        self.preprocessor, self.postprocessor = make_pre_post_processors(
            policy_cfg=policy_cfg,
            pretrained_path=config.POLICY_PATH,
            preprocessor_overrides={
                "device_processor": {"device": device},
                "rename_observations_processor": {"rename_map": config.RENAME_MAP},
            },
        )

        # -- feature/action-key bookkeeping (bản rút gọn của build_rollout_context,
        # bỏ toàn bộ phần dataset/teleop/dagger vì Edge VLA không ghi dataset) ------
        _, robot_action_processor, robot_observation_processor = make_default_processors()
        self.robot_action_processor = robot_action_processor
        self.robot_observation_processor = robot_observation_processor

        observation_features_hw = {
            k: v
            for k, v in robot.observation_features.items()
            if isinstance(v, tuple) or (v is float and k.endswith(".pos"))
        }
        action_features_hw = {k: v for k, v in robot.action_features.items() if k.endswith(".pos")}

        action_dataset_features = aggregate_pipeline_dataset_features(
            pipeline=make_default_processors()[0],
            initial_features=create_initial_features(action=action_features_hw),
            use_videos=False,
        )
        observation_dataset_features = aggregate_pipeline_dataset_features(
            pipeline=robot_observation_processor,
            initial_features=create_initial_features(observation=observation_features_hw),
            use_videos=False,
        )
        self.dataset_features = combine_feature_dicts(action_dataset_features, observation_dataset_features)
        self.hw_features = hw_to_dataset_features(observation_features_hw, "observation")
        self.ordered_action_keys = list(action_features_hw.keys())

        self.engine = SyncInferenceEngine(
            policy=self.policy,
            preprocessor=self.preprocessor,
            postprocessor=self.postprocessor,
            dataset_features=self.dataset_features,
            ordered_action_keys=self.ordered_action_keys,
            task="",
            device=device,
            robot_type=robot.robot_type,
        )

    def reset(self):
        """Xoá state nội bộ (policy + pre/post-processor) — bắt buộc gọi trước mỗi
        take_action mới (chunk cũ không còn hợp lệ cho task/scene mới)."""
        self.engine.reset()

    def act(self, observation: dict, task_text: str) -> dict:
        """Trả action dict `{"<motor>.pos": float}` sẵn sàng đưa cho
        `robot.send_action`."""
        obs_processed = self.robot_observation_processor(observation)
        obs_frame = build_dataset_frame(self.dataset_features, obs_processed, prefix=OBS_STR)
        # SyncInferenceEngine không expose setter công khai cho task (lerobot-rollout
        # gán 1 lần lúc khởi tạo, task không đổi trong suốt phiên); subgoal ở đây đổi
        # theo từng take_action nên phải set trực tiếp field private trước mỗi lượt act.
        self.engine._task = task_text
        action_tensor = self.engine.get_action(obs_frame)
        return {k: action_tensor[i].item() for i, k in enumerate(self.ordered_action_keys)}
