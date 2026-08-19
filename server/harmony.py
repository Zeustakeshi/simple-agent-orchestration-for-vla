"""Tách luồng token của model thành hai dòng: LỜI NÓI và SUY NGHĨ.

Vì sao cần file này: các model kiểu harmony (gpt-oss, một số bản trên Ollama
Cloud/OpenRouter) không trả về một chuỗi trả lời sạch. Chúng phát ra nguyên văn
các token điều khiển của định dạng:

    <|start|>assistant<|channel|>analysis<|message|>...nghĩ thầm...<|end|>
    <|start|>assistant<|channel|>final<|message|>...câu trả lời...<|return|>

`ChatOpenAI` không hiểu những token đó — với nó tất cả chỉ là `content`, nên cả
phần nghĩ thầm lẫn mấy cái `<|channel|>` trần trụi đều chảy thẳng ra bong bóng
chat. Đó chính là thứ người dùng đang nhìn thấy trên giao diện.

Bộ tách này chạy TRÊN LUỒNG: token đến từng mẩu, một dấu hiệu như `<|channel|>`
có thể bị cắt làm đôi giữa hai chunk, nên phần đuôi chưa đủ để kết luận sẽ được
GIỮ LẠI tới chunk sau thay vì phát ra rồi mới hối hận. Không giữ thì chính cái
`<|` lẻ đó là thứ lọt ra màn hình.

Ngoài harmony, bộ tách hiểu luôn `<think>...</think>` (DeepSeek-R1, Qwen) vì
cùng một bài toán và cùng một chỗ sửa.
"""

from __future__ import annotations

# Kênh nào là "nói với người dùng". Mọi kênh khác coi là suy nghĩ nội bộ:
# thà giấu nhầm một câu vào khối suy nghĩ (vẫn mở ra xem được) còn hơn đổ
# nguyên chain-of-thought vào bong bóng trả lời.
TEXT_CHANNELS = {"", "final", "message", "output", "assistant"}

# Token điều khiển nuốt luôn phần chữ đi sau nó cho tới dấu hiệu kế tiếp.
# `<|start|>assistant` — chữ "assistant" là vai, không phải lời model nói.
_SWALLOW_AFTER = {"start", "constrain", "recipient", "to"}

_MAX_MARKER_LEN = 16  # `<|constrain|>` là dấu hiệu dài nhất còn phải chờ.

Piece = tuple[str, str]  # ("text" | "reasoning", chunk)


class ChannelSplitter:
    """Một bộ tách cho MỘT tin nhắn của model. Hết tin nhắn thì gọi `flush()`.

    Dùng lại cho tin nhắn sau cũng được, nhưng phải `reset()` — trạng thái kênh
    của lượt trước rơi sang lượt sau sẽ khiến câu trả lời bị xếp nhầm vào suy
    nghĩ.
    """

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._buf = ""
        self._channel = "final"
        # None = đang ở thân; "channel" = đang đọc tên kênh; "discard" = đang
        # nuốt phần chữ sau một token điều khiển.
        self._pending: str | None = None
        self._name = ""

    # ---------------------------------------------------------------- public

    def feed(self, delta: str) -> list[Piece]:
        """Nạp một mẩu token, trả về các phần đã CHẮC CHẮN thuộc kênh nào."""
        if not delta:
            return []
        self._buf += delta
        return self._drain()

    def flush(self) -> list[Piece]:
        """Chốt phần còn lại khi model đã nói xong.

        Phần đuôi trông như một dấu hiệu dở dang thì BỎ, không phát: nó là token
        điều khiển bị cắt cụt, không phải chữ của model.
        """
        out = self._drain()
        rest = self._buf
        self._buf = ""
        if self._pending == "channel":
            # Tên kênh về dở rồi hết luồng. `_commit_channel_name` quyết định
            # đó là tên kênh (bỏ) hay thật ra là chữ (giữ).
            self._name += rest
            rest = ""
            piece = self._commit_channel_name()
            if piece:
                out = _merge(out, [piece])
        elif self._pending == "discard":
            rest = ""
        if rest and not _looks_like_partial_marker(rest):
            piece = self._emit(rest)
            if piece:
                out = _merge(out, [piece])
        self._pending = None
        self._name = ""
        return out

    # --------------------------------------------------------------- interne

    def _drain(self) -> list[Piece]:
        out: list[Piece] = []

        while self._buf:
            if self._pending in ("channel", "discard"):
                idx = self._buf.find("<|")
                # Tên kênh là MỘT TỪ, không bao giờ có khoảng trắng. Kết thúc ở
                # khoảng trắng đầu tiên nữa, vì có model phát `<|channel|>thought`
                # rồi xuống dòng và nói luôn, không kèm `<|message|>` — chỉ chờ
                # `<|` thì toàn bộ câu sau đó bị nuốt làm tên kênh.
                space = _find_space(self._buf)
                if space != -1 and (idx == -1 or space < idx):
                    idx = space
                if idx == -1:
                    # Chưa thấy dấu hiệu kế — tên kênh có thể còn chảy tiếp.
                    # GIỮ LẠI dấu `<` ở cuối: nó rất có thể là nửa đầu của
                    # `<|message|>` đang về dở. Nuốt nó ở đây thì dấu hiệu kế
                    # tiếp không bao giờ khớp, và toàn bộ phần sau — kể cả câu
                    # trả lời — bị đọc thành tên kênh rồi biến mất.
                    keep = 1 if self._buf.endswith("<") else 0
                    consumed = self._buf[: len(self._buf) - keep]
                    if self._pending == "channel":
                        self._name += consumed
                    self._buf = self._buf[len(consumed) :]
                    break
                piece = None
                if self._pending == "channel":
                    self._name += self._buf[:idx]
                    piece = self._commit_channel_name()
                if piece:
                    out = _merge(out, [piece])
                # Kết bằng khoảng trắng thì NUỐT LUÔN ký tự đó: nó là dấu ngắt
                # của tên kênh, không phải chữ model muốn nói. Để lại thì mọi
                # đoạn suy nghĩ mở đầu bằng một dòng trống.
                #
                # Trừ khi phần vừa đọc hoá ra là CHỮ (`piece` khác None) — lúc
                # đó khoảng trắng cũng là chữ, cắt đi thì hai từ dính vào nhau.
                eat = 1 if (idx == space and piece is None) else 0
                self._buf = self._buf[idx + eat :]
                self._pending = None
                self._name = ""
                continue

            i = self._buf.find("<")
            if i == -1:
                piece = self._emit(self._buf)
                self._buf = ""
                if piece:
                    out = _merge(out, [piece])
                break

            if i > 0:
                piece = self._emit(self._buf[:i])
                self._buf = self._buf[i:]
                if piece:
                    out = _merge(out, [piece])

            if self._buf.startswith("<|"):
                j = self._buf.find("|>", 2)
                if j == -1:
                    if len(self._buf) <= _MAX_MARKER_LEN:
                        break  # chờ thêm token, đừng đoán
                    # Quá dài để còn là dấu hiệu — trả `<` về cho chữ.
                    piece = self._emit("<")
                    self._buf = self._buf[1:]
                    if piece:
                        out = _merge(out, [piece])
                    continue
                token = self._buf[2:j].strip().lower()
                self._buf = self._buf[j + 2 :]
                self._handle_token(token)
                continue

            low = self._buf.lower()
            if low.startswith("<think>"):
                self._channel = "analysis"
                self._buf = self._buf[7:]
                continue
            if low.startswith("</think>"):
                self._channel = "final"
                self._buf = self._buf[8:]
                continue
            if _looks_like_partial_marker(self._buf):
                break  # `<thi`, `</th`, `<|` — chờ đủ rồi hãy quyết

            piece = self._emit("<")
            self._buf = self._buf[1:]
            if piece:
                out = _merge(out, [piece])

        return out

    def _handle_token(self, token: str) -> None:
        if token == "channel":
            self._pending = "channel"
            self._name = ""
        elif token == "message":
            self._pending = None
        elif token in _SWALLOW_AFTER:
            self._pending = "discard"
        elif token in ("end", "return"):
            # Hết một đoạn. Chưa biết đoạn sau thuộc kênh nào; mặc định là lời
            # nói, vì đoạn suy nghĩ luôn tự khai báo `<|channel|>analysis`.
            self._channel = "final"
            self._pending = None
        # Token lạ: bỏ im lặng — nó là chuyện nội bộ của định dạng.

    def _commit_channel_name(self) -> Piece | None:
        """Chốt tên kênh vừa đọc được sau `<|channel|>`.

        KHÔNG tin bừa vào những gì đi sau dấu hiệu. Tên kênh của harmony luôn là
        một định danh thường, ngắn (`analysis`, `final`, `commentary`,
        `thought`). Có model phát `<|channel|>` trần rồi nói luôn — lúc đó chữ
        đi sau là LỜI NÓI, và nuốt nó làm tên kênh thì câu trả lời biến mất khỏi
        màn hình. Không giống tên kênh thì trả về thành chữ.
        """
        name = self._name.strip()
        self._name = ""
        if not name:
            self._channel = ""  # `<|channel|>` trần — coi như kênh nói.
            return None
        if len(name) <= 24 and all(c.isascii() and (c.islower() or c.isdigit() or c == "_") for c in name):
            self._channel = name.lower()
            return None
        # Không phải tên kênh ⇒ `<|channel|>` đứng trần rồi model nói luôn. Kênh
        # về mặc định (lời nói) TRƯỚC khi phát, nếu không phần này vẫn bị xếp
        # vào kênh suy nghĩ của đoạn trước đó.
        self._channel = ""
        return self._emit(name)

    def _emit(self, chunk: str) -> Piece | None:
        if not chunk:
            return None
        kind = "text" if self._channel in TEXT_CHANNELS else "reasoning"
        return (kind, chunk)


def _find_space(text: str) -> int:
    """Vị trí ký tự trắng đầu tiên, hoặc -1."""
    for i, ch in enumerate(text):
        if ch.isspace():
            return i
    return -1


def _looks_like_partial_marker(text: str) -> bool:
    """`text` có thể là phần đầu của một dấu hiệu chưa về đủ hay không."""
    if not text.startswith("<"):
        return False
    if len(text) > _MAX_MARKER_LEN:
        return False
    low = text.lower()
    # `<|chan` — đã chắc chắn là dấu hiệu, chỉ chưa về hết.
    if low.startswith("<|"):
        return True
    # `<th`, `</thi` — mới chỉ có thể là dấu hiệu.
    return any(m.startswith(low) for m in ("<|", "<think>", "</think>"))


def _merge(head: list[Piece], tail: list[Piece]) -> list[Piece]:
    """Gộp hai mẩu liền nhau cùng kênh — bớt số sự kiện SSE phải phát."""
    out = list(head)
    for kind, chunk in tail:
        if out and out[-1][0] == kind:
            out[-1] = (kind, out[-1][1] + chunk)
        else:
            out.append((kind, chunk))
    return out


def strip_control_tokens(text: str) -> str:
    """Bản một-phát cho chuỗi đã đủ: chỉ giữ phần lời nói.

    Dùng cho những chỗ nhận nguyên câu trả lời chứ không phải luồng token.
    """
    splitter = ChannelSplitter()
    pieces = _merge(splitter.feed(text), splitter.flush())
    return "".join(chunk for kind, chunk in pieces if kind == "text")
