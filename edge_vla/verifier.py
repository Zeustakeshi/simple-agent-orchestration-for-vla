"""Bản MVP của khối VERIFIER (thay cho YOLO/classifier thật): dùng predicate BDDL
ground-truth có sẵn trong LIBERO (~ms, không cần model riêng) + toạ độ raw object
để agent có số liệu suy luận khi replan."""

from __future__ import annotations

from .sim_env import SimHandle


def check_success(sim: SimHandle) -> bool:
    return sim.check_success()


def detections(sim: SimHandle) -> dict:
    return sim.detections()
