"""Lõi async/retry/recovery của Edge VLA.

EGL constraint (PLAN.md "Rủi ro"): context EGL được tạo ở thread nào thì mọi lời gọi
GL sau đó (env.step, và cả `_get_observations()` vì nó RE-RENDER camera) phải nằm ở
đúng thread đó. Vì vậy `SimHandle`/`PolicyRunner` được khởi tạo bên trong MỘT worker
thread duy nhất, và mọi thao tác chạm sim (take_action, go_home, recovery,
reset_episode, check_success) đều được post vào hàng đợi job của thread đó thay vì
gọi trực tiếp từ MCP request thread.

`take_action` trả về ngay (~10ms): chỉ enqueue job, không chờ.
`check_status` là async/blocking-đúng-nghĩa (await asyncio.sleep) nên vẫn phục vụ
`abort` song song trong lúc đang chờ.
`capture()` / `get_robot_state()` KHÔNG chạm sim trực tiếp — chỉ đọc frame buffer đã
publish (viewer) và state python thuần (store, sim.task_id) để không phải xếp hàng
sau một take_action đang chạy.
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

from . import config, safety, verifier
from .policy_runner import PolicyRunner
from .sim_env import SimHandle
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

_GRIPPER_OPEN = -1.0


class Controller:
    def __init__(self, viewer: Viewer, store: TaskStore):
        self.viewer = viewer
        self.store = store
        self.sim: SimHandle | None = None
        self.policy: PolicyRunner | None = None

        self._jobs: queue.Queue = queue.Queue()
        self._ready = threading.Event()
        self._worker = threading.Thread(target=self._worker_loop, name="sim-worker", daemon=True)
        self._worker.start()
        self._ready.wait()

    # -- single dedicated sim/EGL thread -----------------------------------
    def _worker_loop(self) -> None:
        self.sim = SimHandle()
        self.policy = PolicyRunner()
        self.viewer.publish(self.sim.frames())
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
                    logger.exception("Unhandled error in sim-worker job")

    def _submit(self, fn, *args, wait: bool = True, timeout: float | None = None, **kwargs):
        fut = cf.Future() if wait else None
        self._jobs.put((fn, args, kwargs, fut))
        if wait:
            return fut.result(timeout=timeout)
        return None

    # -- read-only tools (không chạm sim) ----------------------------------
    def get_robot_state(self) -> dict:
        assert self.sim is not None
        return {
            "current_task_id": self.store.current_task_id,
            "busy": self.store.busy,
            "retry_count": self.store.retry_count,
            "current_libero_task_id": self.sim.task_id,
            "libero_tasks": self.sim.language_list(),
        }

    def capture(self) -> dict:
        """Đọc frame buffer đã publish — KHÔNG tự render (xem docstring module)."""
        frames = self.viewer.latest_frames()
        return {"images": encode_frames_b64(frames) if frames else {}}

    # -- take_action / check_status ------------------------------------------
    def take_action(self, subgoal: str, k: int, libero_task_id: int | None = None) -> dict:
        if self.store.busy:
            return {"status": ROBOT_BUSY, "current_task_id": self.store.current_task_id}

        assert self.sim is not None
        k = int(np.clip(int(k), 1, config.MAX_K))
        resolved_task_id = (
            int(libero_task_id) if libero_task_id is not None else self.sim.resolve_task_id(subgoal)
        )

        new_task_id = str(uuid.uuid4())
        self.store.start_task(new_task_id, k)
        self._submit(self._run_task, new_task_id, resolved_task_id, k, wait=False)
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

    # -- other tools (chạm sim -> qua worker) --------------------------------
    def check_success(self) -> dict:
        return self._submit(self._check_success_job)

    def go_home(self) -> dict:
        return self._submit(self._go_home_job)

    def abort(self, task_id: str | None = None) -> dict:
        self.store.abort_flag = True
        return {"status": "ABORTING"}

    def reset_episode(self) -> dict:
        self.store.abort_flag = True
        time.sleep(0.15)  # nhường CPU cho job đang chạy (nếu có) tự thoát trước
        result = self._submit(self._reset_episode_job)
        self.store.retry_count = 0
        self.store.busy = False
        self.store.abort_flag = False
        return result

    # -- job bodies: LUÔN chạy trong sim-worker thread -----------------------
    def _check_success_job(self) -> dict:
        return {"success": verifier.check_success(self.sim), "detections": verifier.detections(self.sim)}

    def _go_home_job(self) -> dict:
        self._go_home()
        return {"status": "DONE", "eef_pos": list(self.sim.last_obs["robot_state"]["eef"]["pos"])}

    def _reset_episode_job(self) -> dict:
        self.sim.reset_episode()
        self.viewer.publish(self.sim.frames())
        return {"status": "DONE"}

    def _run_task(self, task_id: str, libero_task_id: int, k: int) -> None:
        if libero_task_id != self.sim.task_id:
            self.sim.switch_task(libero_task_id)
            self.store.retry_count = 0

        start = time.time()
        task_text = self.sim.tasks[self.sim.task_id].language
        action = None
        i = 0
        try:
            self.policy.reset()
            for i in range(k):
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

                ok, reason = safety.check(self.sim.mj_state())
                if not ok:
                    self._emergency_stop()
                    self.store.update(
                        task_id,
                        status=SAFETY_STOP,
                        reason=reason,
                        step=i,
                        images=encode_frames_b64(self.sim.frames()),
                        safe_at_home=False,
                    )
                    return

                action = self.policy.act(self.sim.last_obs, task_text)
                self.sim.step(action)
                self.viewer.publish(self.sim.frames())
                self.viewer.set_overlay(f"{RUNNING} | {i + 1}/{k} | retry={self.store.retry_count}")
                self.store.update(task_id, step=i + 1)

            # VLA dừng -> rút gripper: vài step no-op để vật ổn định
            last_gripper = float(action[-1]) if action is not None else _GRIPPER_OPEN
            noop = np.array([0, 0, 0, 0, 0, 0, last_gripper], dtype=np.float32)
            for _ in range(5):
                self.sim.step(noop)

            success = verifier.check_success(self.sim)
            images = encode_frames_b64(self.sim.frames())
            detections = verifier.detections(self.sim)

            if success:
                self.store.retry_count = 0
                self.store.update(task_id, status=DONE, success=True, images=images, detections=detections)
                self.viewer.set_overlay(f"{DONE} success | retry={self.store.retry_count}")
                return

            self.store.retry_count += 1
            if self.store.retry_count >= config.MAX_RETRY:
                self._recovery()
                self.store.update(
                    task_id,
                    status=FAILED_MAX_RETRY,
                    success=False,
                    images=images,
                    detections=detections,
                    safe_at_home=True,
                )
                self.viewer.set_overlay(f"{FAILED_MAX_RETRY} | retry={self.store.retry_count}")
            else:
                self.store.update(task_id, status=DONE, success=False, images=images, detections=detections)
                self.viewer.set_overlay(f"{DONE} fail | retry={self.store.retry_count}")
        finally:
            self.store.finish_task()

    def _emergency_stop(self) -> None:
        """Dừng vòng lặp ngay, giữ nguyên tư thế hiện tại — KHÔNG tự retry, KHÔNG
        tự go_home (giữ nguyên trạng thái để agent/người kiểm tra)."""
        self.store.abort_flag = True
        self.viewer.set_overlay(f"{SAFETY_STOP}")

    def _recovery(self) -> None:
        """Mở gripper -> lùi Z +10cm -> về home. Gọi khi FAILED_MAX_RETRY."""
        self._open_gripper()
        self._lift_z(0.10)
        self._go_home()

    def _open_gripper(self, steps: int = 10) -> None:
        action = np.array([0, 0, 0, 0, 0, 0, _GRIPPER_OPEN], dtype=np.float32)
        for _ in range(steps):
            self.sim.step(action)

    def _lift_z(self, dz: float, steps: int = 15) -> None:
        action = np.array([0, 0, float(np.clip(dz, -1, 1)), 0, 0, 0, _GRIPPER_OPEN], dtype=np.float32)
        for _ in range(steps):
            self.sim.step(action)

    def _go_home(self, max_steps: int = 40) -> None:
        """Không dùng env.reset() — sẽ teleport cả object và mất trạng thái scene.
        Đi bằng action tương đối (relative control), tối đa max_steps."""
        for _ in range(max_steps):
            eef = np.asarray(self.sim.last_obs["robot_state"]["eef"]["pos"], dtype=np.float64)
            delta = self.sim.home_eef_pos - eef
            dist = float(np.linalg.norm(delta))
            if dist < 0.01:
                break
            direction = delta / dist
            step = np.clip(direction * min(dist, 1.0) * 3.0, -1.0, 1.0)
            action = np.array([step[0], step[1], step[2], 0, 0, 0, _GRIPPER_OPEN], dtype=np.float32)
            self.sim.step(action)
