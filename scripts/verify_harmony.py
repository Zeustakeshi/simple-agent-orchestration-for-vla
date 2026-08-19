#!/usr/bin/env python
"""Kiểm chứng `server/harmony.py` — bộ tách LỜI NÓI khỏi SUY NGHĨ.

Chạy: python scripts/verify_harmony.py

Vì sao đáng có một file kiểm riêng: bộ tách chạy trên LUỒNG, và mọi lỗi của nó
đều thuộc loại "chỉ lộ ra khi token bị cắt ở đúng chỗ hiểm". Mỗi khẳng định ở
đây là một cảnh ĐÃ THẤY trên màn hình: token `<|channel|>` rò ra bong bóng chat,
dấu hiệu bị xẻ đôi giữa hai chunk SSE, câu trả lời bị nuốt vì đứng ngay sau một
`<|channel|>` trần.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.harmony import ChannelSplitter, strip_control_tokens  # noqa: E402


def run(chunks: list[str]) -> dict[str, str]:
    splitter = ChannelSplitter()
    pieces: list[tuple[str, str]] = []
    for chunk in chunks:
        pieces += splitter.feed(chunk)
    pieces += splitter.flush()
    out = {"text": "", "reasoning": ""}
    for kind, chunk in pieces:
        out[kind] += chunk
    return out


def check(label: str, got, want) -> None:
    assert got == want, f"{label}: nhận {got!r}, cần {want!r}"
    print(f"  ok  {label}")


HARMONY = (
    "<|channel|>analysis<|message|>Tôi cần chụp ảnh trước.<|end|>"
    "<|start|>assistant<|channel|>final<|message|>Chào bạn!"
)
WANT = {"text": "Chào bạn!", "reasoning": "Tôi cần chụp ảnh trước."}

print("harmony đầy đủ — mọi cách cắt phải ra cùng một kết quả")
check("nguyên khối", run([HARMONY]), WANT)
check("từng ký tự", run(list(HARMONY)), WANT)
check("cắt giữa dấu hiệu", run([HARMONY[:14], HARMONY[14:31], HARMONY[31:]]), WANT)

print("biến thể")
check(
    "dấu hiệu bị xẻ đôi",
    run(["<|chan", "nel|>thought<|mess", "age|>nghĩ", "<|end|>nói tiếp"]),
    {"text": "nói tiếp", "reasoning": "nghĩ"},
)
check("<think>", run(["<think>", "hmm", "</think>", "Xin chào"]), {"text": "Xin chào", "reasoning": "hmm"})
check(
    "kênh không có <|message|> — đúng cảnh đã rò ra giao diện",
    run(["<|channel|>thought\nĐang gắp hộp sữa.<|channel|>", "Robot đã gắp xong."]),
    {"text": "Robot đã gắp xong.", "reasoning": "Đang gắp hộp sữa."},
)

print("không đụng vào chữ thường")
check("dấu < trong câu", run(["Nhiệt độ 5 < 3 và a<b"]), {"text": "Nhiệt độ 5 < 3 và a<b", "reasoning": ""})
check("đuôi dở dang bị bỏ", run(["Xong.", "<|chan"]), {"text": "Xong.", "reasoning": ""})

print("strip_control_tokens")
check("một phát", strip_control_tokens(HARMONY), "Chào bạn!")
check("chuỗi sạch giữ nguyên", strip_control_tokens("Bình thường"), "Bình thường")

print("\nOK - harmony splitter đạt.")
