"""dict[task_id] -> state, thread-safe (một thread nền ghi, MCP server nhiều thread
đọc). Cộng thêm state toàn cục mà controller cần: current_task_id / busy /
retry_count / poll_count."""

from __future__ import annotations

import threading
import time
from typing import Any

RUNNING = "RUNNING"
DONE = "DONE"
FAILED_MAX_RETRY = "FAILED_MAX_RETRY"
SAFETY_STOP = "SAFETY_STOP"
TIMEOUT = "TIMEOUT"
ABORTED = "ABORTED"
ROBOT_BUSY = "ROBOT_BUSY"


class TaskStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._tasks: dict[str, dict[str, Any]] = {}
        self.current_task_id: str | None = None
        self.busy: bool = False
        self.retry_count: int = 0
        self.poll_count: int = 0
        self.abort_flag: bool = False

    # -- CRUD on individual tasks ---------------------------------------
    def update(self, task_id: str, **fields: Any) -> None:
        with self._lock:
            if task_id in self._tasks:
                self._tasks[task_id].update(fields)
                self._tasks[task_id]["ts"] = time.time()

    def get(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            task = self._tasks.get(task_id)
            return dict(task) if task is not None else None

    # -- global controller state ------------------------------------------
    def start_task(self, task_id: str, total: int) -> None:
        with self._lock:
            self.busy = True
            self.current_task_id = task_id
            self.poll_count = 0
            self.abort_flag = False
            self._tasks[task_id] = {
                "status": RUNNING,
                "step": 0,
                "total": total,
                "success": None,
                "images": {},
                "detections": None,
                "reason": None,
                "safe_at_home": None,
                "ts": time.time(),
            }

    def finish_task(self) -> None:
        with self._lock:
            self.busy = False
