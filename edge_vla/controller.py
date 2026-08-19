"""Lõi async/retry/recovery của Edge VLA.

Mọi thao tác chạm robot (connect, get_observation, send_action) chạy trong ĐÚNG MỘT
worker thread (serial bus Feetech không thread-safe) — `RobotHandle`/`PolicyRunner`
được khởi tạo bên trong worker thread đó, và mọi job (take_action, go_home, recovery,
reset_episode) được post vào hàng đợi job của thread đó thay vì gọi trực tiếp từ MCP
request thread.

`take_action` trả về ngay (~10ms): chỉ enqueue job, không chờ.
`check_status` là async/blocking-đúng-nghĩa (await asyncio.sleep) nên vẫn phục vụ
`abort` song song trong lúc đang chờ.
`capture()` / `get_robot_state()` KHÔNG chạm sim trực tiếp — chỉ đọc frame buffer đã
publish (viewer) và state python thuần (store, robot.last_obs) để không phải xếp hàng
sau một take_action đang chạy.

Robot thật KHÔNG có ground-truth success (không còn predicate BDDL như bản mô phỏng):
mọi lượt `take_action` kết thúc với `success=None`, agent PHẢI tự xem ảnh (`capture()`
hoặc ảnh trả kèm `check_status`) để quyết định. `retry_count` giờ đếm số lần
`take_action` LIÊN TIẾP gọi cùng một `subgoal` (thay vì đếm theo lần thất bại đo được)
— khi chạm `MAX_RETRY`, edge tự động recovery (mở gripper + về home) và báo
`FAILED_MAX_RETRY`, agent phải hỏi user thay vì tự ý retry thêm.
"""

from __future__ import annotations

import asyncio
import concurrent.futures as cf
import logging
import queue
import threading
import time
import uuid

import numpy as np
from lerobot.utils.robot_utils import precise_sleep

from . import config, safety
from .policy_runner import PolicyRunner
from .robot_env import RobotHandle
from .task_store import (
    ABORTED,
    DONE,
    FAILED_MAX_RETRY,
    ROBOT_BUSY,
    RUNNING,
    SAFETY_STOP,
    TIMEOUT,
    TaskStore,
)
from .viewer import Viewer, encode_frames_b64

logger = logging.getLogger(__name__)


class Controller:
    def __init__(self, viewer: Viewer, store: TaskStore):
        self.viewer = viewer
        self.store = store
        self.robot: RobotHandle | None = None
        self.policy: PolicyRunner | None = None
        self._last_subgoal: str | None = None

        self._jobs: queue.Queue = queue.Queue()
        self._ready = threading.Event()
        self._worker = threading.Thread(target=self._worker_loop, name="robot-worker", daemon=True)
        self._worker.start()
        self._ready.wait()

    # -- single dedicated robot-serial-bus thread ---------------------------
    def _worker_loop(self) -> None:
        self.robot = RobotHandle()
        self.policy = PolicyRunner(self.robot.robot)
        self.viewer.publish(self.robot.frames())
        self._ready.set()
        while True:
            fn, args, kwargs, fut = self._jobs.get()
            try:
                result = fn(*args, **kwargs)
                if fut is not None:
                    fut.set_result(result)
            except Exception as exc:  # noqa: BLE001
                if fut is not None:
                    fut.set_exception(exc)
                else:
                    logger.exception("Unhandled error in robot-worker job")

    def _submit(self, fn, *args, wait: bool = True, timeout: float | None = None, **kwargs):
        fut = cf.Future() if wait else None
        self._jobs.put((fn, args, kwargs, fut))
        if wait:
            return fut.result(timeout=timeout)
        return None

    # -- read-only tools (không chạm robot) ----------------------------------
    def get_robot_state(self) -> dict:
        assert self.robot is not None
        return {
            "current_task_id": self.store.current_task_id,
            "busy": self.store.busy,
            "retry_count": self.store.retry_count,
            "connected": self.robot.robot.is_connected,
            "joint_positions": self.robot.joint_state(),
            "cameras": self.robot.camera_names,
        }

    def capture(self) -> dict:
        """Đọc frame buffer đã publish — KHÔNG tự render (xem docstring module)."""
        frames = self.viewer.latest_frames()
        return {"images": encode_frames_b64(frames) if frames else {}}

    def check_success(self) -> dict:
        """SYNC, không chạm robot. Robot thật không có ground-truth success — agent
        PHẢI tự xem ảnh (capture()) để quyết định."""
        return {
            "success": None,
            "note": "Không có ground-truth trên robot thật — dùng capture() rồi tự đánh giá qua ảnh.",
        }

    # -- take_action / check_status ------------------------------------------
    def take_action(self, subgoal: str, k: int) -> dict:
        if self.store.busy:
            return {"status": ROBOT_BUSY, "current_task_id": self.store.current_task_id}

        assert self.robot is not None
        k = int(np.clip(int(k), 1, config.MAX_K))

        norm_subgoal = subgoal.strip().lower()
        if norm_subgoal == self._last_subgoal:
            self.store.retry_count += 1
        else:
            self.store.retry_count = 0
        self._last_subgoal = norm_subgoal

        new_task_id = str(uuid.uuid4())
        self.store.start_task(new_task_id, k)

        if self.store.retry_count >= config.MAX_RETRY:
            self._submit(self._recovery_task, new_task_id, wait=False)
        else:
            self._submit(self._run_task, new_task_id, subgoal, k, wait=False)
        return {"task_id": new_task_id, "status": RUNNING}

    async def check_status(self, task_id: str, wait_s: float) -> dict:
        wait_s = float(np.clip(float(wait_s), *config.WAIT_CLAMP))

        self.store.poll_count += 1
        if self.store.poll_count > config.MAX_POLL:
            self.abort(task_id)
            self.store.update(task_id, status=TIMEOUT, reason="poll count exceeded MAX_POLL")
            return self.store.get(task_id) or {"status": TIMEOUT}

        elapsed = 0.0
        while elapsed < wait_s:
            task = self.store.get(task_id)
            if task is None or task["status"] != RUNNING:
                break
            await asyncio.sleep(0.2)
            elapsed += 0.2

        return self.store.get(task_id) or {"status": "UNKNOWN", "task_id": task_id}

    # -- other tools (chạm robot -> qua worker) --------------------------------
    def go_home(self) -> dict:
        return self._submit(self._go_home_job)

    def abort(self, task_id: str | None = None) -> dict:
        self.store.abort_flag = True
        return {"status": "ABORTING"}

    def reset_episode(self) -> dict:
        """Robot thật không có scene để reset — hành động tương đương là abort task
        hiện tại (nếu có), về home, và xoá state retry/subgoal đang theo dõi."""
        self.store.abort_flag = True
        time.sleep(0.15)  # nhường CPU cho job đang chạy (nếu có) tự thoát trước
        result = self._submit(self._go_home_job)
        self.store.retry_count = 0
        self.store.busy = False
        self.store.abort_flag = False
        self._last_subgoal = None
        return result

    # -- job bodies: LUÔN chạy trong robot-worker thread -----------------------
    def _go_home_job(self) -> dict:
        self._go_home()
        return {"status": "DONE", "joint_positions": self.robot.joint_state()}

    def _recovery_task(self, task_id: str) -> None:
        try:
            self._recovery()
            self.store.retry_count = 0
            self._last_subgoal = None
            self.store.update(
                task_id,
                status=FAILED_MAX_RETRY,
                success=False,
                images=encode_frames_b64(self.robot.frames()),
                safe_at_home=True,
                reason="đạt MAX_RETRY lần gọi liên tiếp cho cùng subgoal",
            )
            self.viewer.set_overlay(f"{FAILED_MAX_RETRY} | auto recovery")
        finally:
            self.store.finish_task()

    def _run_task(self, task_id: str, subgoal: str, k: int) -> None:
        start = time.time()
        control_interval = 1.0 / config.CONTROL_FREQ
        try:
            self.policy.reset()
            for i in range(k):
                loop_start = time.perf_counter()

                if self.store.abort_flag:
                    # check_status() có thể đã ghi TIMEOUT (poll-limit) song song;
                    # chỉ ghi đè ABORTED nếu task vẫn đang RUNNING (agent tự abort).
                    task_now = self.store.get(task_id)
                    if task_now is not None and task_now["status"] == RUNNING:
                        self.store.update(task_id, status=ABORTED, step=i)
                    return
                if time.time() - start > config.TASK_TIMEOUT_S:
                    self.store.update(task_id, status=TIMEOUT, step=i)
                    return

                current_pos = self.robot.joint_state()
                action = self.policy.act(self.robot.last_obs, subgoal)

                max_delta_key = max(
                    (k2 for k2 in action if k2.endswith(".pos") and k2 in current_pos),
                    key=lambda k2: abs(action[k2] - current_pos[k2]),
                    default=None,
                )
                if max_delta_key is not None:
                    logger.info(
                        "step %d/%d dt=%.0fms RAW target %s: %.1f -> %.1f (Δ=%.1f)",
                        i + 1,
                        k,
                        (time.perf_counter() - loop_start) * 1000,
                        max_delta_key,
                        current_pos[max_delta_key],
                        action[max_delta_key],
                        action[max_delta_key] - current_pos[max_delta_key],
                    )

                ok, reason = safety.check(action, current_pos, self.robot.joint_limits)
                if not ok:
                    self._emergency_stop()
                    self.store.update(
                        task_id,
                        status=SAFETY_STOP,
                        reason=reason,
                        step=i,
                        images=encode_frames_b64(self.robot.frames()),
                        safe_at_home=False,
                    )
                    return

                self.robot.step(action)
                self.viewer.publish(self.robot.frames())
                self.viewer.set_overlay(f"{RUNNING} | {i + 1}/{k} | retry={self.store.retry_count}")
                self.store.update(task_id, step=i + 1)

                # Giữ nhịp gửi lệnh đúng control.fps (config.yaml) — n_action_steps>1
                # replay một chunk NHIỀU timestep liên tiếp từ 1 lần inference; nếu gửi
                # dồn dập không nghỉ, servo (position-mode) chưa kịp đuổi theo target
                # trước đó thì mục tiêu đã đổi sang timestep sau, robot chỉ "nhích" theo
                # target luôn di chuyển thay vì thực sự bắt kịp để hoàn thành động tác.
                dt = time.perf_counter() - loop_start
                if (sleep_t := control_interval - dt) > 0:
                    precise_sleep(sleep_t)

            images = encode_frames_b64(self.robot.frames())
            self.store.update(task_id, status=DONE, success=None, images=images, detections={})
            self.viewer.set_overlay(f"{DONE} | retry={self.store.retry_count}")
        finally:
            self.store.finish_task()

    def _emergency_stop(self) -> None:
        """Dừng vòng lặp ngay, giữ nguyên tư thế hiện tại — KHÔNG tự retry, KHÔNG
        tự go_home (giữ nguyên trạng thái để agent/người kiểm tra)."""
        self.store.abort_flag = True
        self.viewer.set_overlay(f"{SAFETY_STOP}")

    def _recovery(self) -> None:
        """Mở gripper -> về home. Gọi khi FAILED_MAX_RETRY. Không có Cartesian
        control/IK cho SO-101 trong MVP này nên bỏ bước "lùi Z" của bản mô phỏng."""
        self._open_gripper()
        self._go_home()

    def _open_gripper(self, steps: int = 10) -> None:
        target = self.robot.home_positions.get("gripper.pos")
        if target is None:
            return
        current = self.robot.joint_state().get("gripper.pos", target)
        for i in range(1, steps + 1):
            t = i / steps
            self.robot.step({"gripper.pos": current + (target - current) * t})

    def _go_home(self, max_steps: int = 40) -> None:
        """Nội suy tuyến tính từng joint hiện tại -> home_positions (vị trí lúc
        connect), clamp bước di chuyển theo SAFETY_MAX_STEP_DEG mỗi lần gửi."""
        for _ in range(max_steps):
            current = self.robot.joint_state()
            delta = {k: v - current[k] for k, v in self.robot.home_positions.items() if k in current}
            if not delta or max(abs(v) for v in delta.values()) < 1.0:
                break
            action = {
                k: current[k] + float(np.clip(d, -config.SAFETY_MAX_STEP_DEG, config.SAFETY_MAX_STEP_DEG))
                for k, d in delta.items()
            }
            self.robot.step(action)
