"""Frame buffer 1 slot (lock) được ghi từ worker thread (controller) và đọc từ
main thread (cv2.imshow — BẮT BUỘC main thread) + MCP thread (MJPEG stream)."""

from __future__ import annotations

import base64
import threading
import time

import cv2
import numpy as np


def encode_jpeg_b64(frame: np.ndarray, quality: int = 70, resize: int | None = 256) -> str:
    img = frame
    if resize is not None and (img.shape[0] != resize or img.shape[1] != resize):
        img = cv2.resize(img, (resize, resize))
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return base64.b64encode(buf.tobytes()).decode("ascii")


def encode_frames_b64(frames: dict[str, np.ndarray]) -> dict[str, str]:
    return {name: encode_jpeg_b64(frame) for name, frame in frames.items()}


class Viewer:
    def __init__(self, window_name: str = "MVP VLA - Robot"):
        self.window_name = window_name
        self._lock = threading.Lock()
        self._frames: dict[str, np.ndarray] | None = None
        self._overlay = ""

    def publish(self, frames: dict[str, np.ndarray]) -> None:
        with self._lock:
            self._frames = frames

    def set_overlay(self, text: str) -> None:
        with self._lock:
            self._overlay = text

    def latest_frames(self) -> dict[str, np.ndarray] | None:
        with self._lock:
            return dict(self._frames) if self._frames is not None else None

    def _latest_bgr(self):
        with self._lock:
            frames = self._frames
            overlay = self._overlay
        if not frames:
            return None
        images = list(frames.values())
        target_h = images[0].shape[0]
        resized = [
            img if img.shape[0] == target_h else cv2.resize(img, (int(img.shape[1] * target_h / img.shape[0]), target_h))
            for img in images
        ]
        stacked = np.hstack(resized)
        bgr = cv2.cvtColor(stacked, cv2.COLOR_RGB2BGR)
        if overlay:
            cv2.putText(bgr, overlay, (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        return bgr

    def run_forever(self, poll_hz: float = 30.0) -> None:
        """PHẢI chạy ở main thread: cv2.imshow không hoạt động đúng ở thread khác."""
        period = 1.0 / poll_hz
        while True:
            frame = self._latest_bgr()
            if frame is not None:
                cv2.imshow(self.window_name, frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
            time.sleep(period)

    def mjpeg_generator(self, fps: float = 15.0):
        period = 1.0 / fps
        while True:
            frame = self._latest_bgr()
            if frame is not None:
                ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
                if ok:
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n")
            time.sleep(period)
