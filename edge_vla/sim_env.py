"""LIBERO env cho Edge VLA: tắt auto-reset (controller cần giữ nguyên scene xuyên
suốt K-step loop) + các helper (frames, mj_state, detections, switch_task) mà
controller/safety/verifier dùng.

EGL constraint (xem PLAN.md "Rủi ro"): context EGL được tạo ở thread nào thì phải
step ở đúng thread đó. `SimHandle` không tự spawn thread — controller.py chịu trách
nhiệm chạy toàn bộ `step()`/`reset()`/`switch_task()` trong đúng một worker thread.
"""

from __future__ import annotations

import numpy as np

from lerobot.envs.libero import LiberoEnv, _get_suite

from . import config


class MvpLiberoEnv(LiberoEnv):
    """LiberoEnv nhưng KHÔNG tự `reset()` khi terminated.

    Bản gốc (`lerobot/envs/libero.py:step`) reset ngay khi `terminated` để phù hợp
    với vòng lặp eval theo episode. Ở đây agent cần quan sát scene NGAY SAU khi
    `take_action` dừng (dù thành công hay chưa) để quyết định go_home/retry/replan —
    auto-reset sẽ teleport lại scene và phá luồng đó.
    """

    def step(self, action: np.ndarray):
        self._ensure_env()
        assert self._env is not None
        if action.ndim != 1:
            raise ValueError(
                f"Expected action to be 1-D (shape (action_dim,)), "
                f"but got shape {action.shape} with ndim={action.ndim}"
            )
        raw_obs, reward, done, info = self._env.step(action)

        is_success = self._env.check_success()
        terminated = done or is_success
        info.update(
            {
                "task": self.task,
                "task_id": self.task_id,
                "done": done,
                "is_success": is_success,
            }
        )
        observation = self._format_raw_obs(raw_obs)
        truncated = False
        return observation, reward, terminated, truncated, info


_PREFIX = "pick_up_the_"
_SUFFIX = "_and_place_it_in_the_basket"


class SimHandle:
    """Một env LIBERO duy nhất + state cần cho controller/safety/verifier."""

    def __init__(self):
        self.suite = _get_suite(config.SUITE)
        self.tasks = [self.suite.get_task(i) for i in range(len(self.suite.tasks))]
        self.task_id: int = 0
        self.env: MvpLiberoEnv | None = None
        self.home_eef_pos: np.ndarray | None = None
        self.last_obs: dict | None = None
        self._build(0)

    # -- lifecycle -----------------------------------------------------
    def _build(self, task_id: int) -> dict:
        if self.env is not None:
            self.env.close()
        self.env = MvpLiberoEnv(
            task_suite=self.suite,
            task_id=task_id,
            task_suite_name=config.SUITE,
            obs_type="pixels_agent_pos",
            observation_height=config.OBS_HEIGHT,
            observation_width=config.OBS_WIDTH,
            control_mode=config.CONTROL_MODE,
            control_freq=config.CONTROL_FREQ,
        )
        self.task_id = task_id
        obs, _info = self.env.reset()
        self.last_obs = obs
        self.home_eef_pos = np.asarray(obs["robot_state"]["eef"]["pos"], dtype=np.float64).copy()
        return obs

    def switch_task(self, task_id: int) -> dict:
        return self._build(task_id)

    def reset_episode(self) -> dict:
        return self._build(self.task_id)

    def step(self, action: np.ndarray):
        obs, reward, terminated, truncated, info = self.env.step(action)
        self.last_obs = obs
        return obs, reward, terminated, truncated, info

    # -- task text <-> task_id ------------------------------------------
    def language_list(self) -> list[dict]:
        return [{"task_id": i, "language": t.language} for i, t in enumerate(self.tasks)]

    def target_object_key(self, task_id: int | None = None) -> str:
        name = self.tasks[self.task_id if task_id is None else task_id].name
        obj = name
        if obj.startswith(_PREFIX):
            obj = obj[len(_PREFIX) :]
        if obj.endswith(_SUFFIX):
            obj = obj[: -len(_SUFFIX)]
        return obj

    def resolve_task_id(self, subgoal: str) -> int:
        """Fuzzy-match subgoal (tiếng Anh, mô tả object) với 10 task.language."""
        text = subgoal.lower()
        best_id, best_score = self.task_id, -1
        for i, t in enumerate(self.tasks):
            obj_words = self.target_object_key(i).replace("_", " ").split()
            score = sum(1 for w in obj_words if w in text)
            if any(w in text for w in obj_words) and score > best_score:
                best_id, best_score = i, score
        if best_score <= 0:
            # fallback: so khớp toàn câu language
            for i, t in enumerate(self.tasks):
                if t.language.lower() in text or text in t.language.lower():
                    return i
        return best_id

    # -- observation helpers ---------------------------------------------
    def frames(self) -> dict[str, np.ndarray]:
        """agentview + wrist, uint8, đã lật H/W giống LiberoEnv.render()."""
        raw_obs = self.env._env.env._get_observations()
        agent = raw_obs["agentview_image"][::-1, ::-1]
        wrist = raw_obs["robot0_eye_in_hand_image"][::-1, ::-1]
        return {"agentview": np.ascontiguousarray(agent), "wrist": np.ascontiguousarray(wrist)}

    def mj_state(self) -> dict:
        """Dùng cho safety.check() — đọc trực tiếp sim, không render lại."""
        assert self.last_obs is not None
        rs = self.last_obs["robot_state"]
        sim = self.env._env.sim
        return {
            "eef_pos": np.asarray(rs["eef"]["pos"], dtype=np.float64),
            "gripper_qpos": np.asarray(rs["gripper"]["qpos"], dtype=np.float64),
            "joint_pos": np.asarray(rs["joints"]["pos"], dtype=np.float64),
            "joint_vel": np.asarray(rs["joints"]["vel"], dtype=np.float64),
            "actuator_force": np.asarray(sim.data.actuator_force, dtype=np.float64),
            "jnt_range": np.asarray(sim.model.jnt_range[:7], dtype=np.float64),
        }

    def detections(self) -> dict:
        """Toạ độ object đích + basket, dùng cho agent replan (bản MVP của VERIFIER)."""
        raw_obs = self.env._env.env._get_observations()
        obj = self.target_object_key()

        def _get(key: str):
            v = raw_obs.get(key)
            return None if v is None else [round(float(x), 4) for x in np.asarray(v).reshape(-1)]

        return {
            "object": obj,
            "object_pos": _get(f"{obj}_1_pos"),
            "basket_pos": _get("basket_1_pos"),
            "object_to_eef_pos": _get(f"{obj}_1_to_robot0_eef_pos"),
        }

    def check_success(self) -> bool:
        return bool(self.env._env.check_success())

    def close(self):
        if self.env is not None:
            self.env.close()
