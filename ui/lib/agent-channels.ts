/* Bản TypeScript của `server/harmony.py` — tách LỜI NÓI khỏi SUY NGHĨ.
 *
 * Vì sao có HAI bản của cùng một thuật toán:
 *
 * Backend đã tách rồi, nên bình thường bộ này không có gì để làm. Nó là chốt
 * chặn thứ hai, cho ba tình huống rất thật:
 *
 *   · backend cũ chưa restart — người dùng vẫn đang nhìn `<|channel|>thought`;
 *   · đổi model/provider, kiểu rò token mới xuất hiện ở nơi backend chưa biết;
 *   · lịch sử phiên đã lưu kèm token điều khiển, tải lại vẫn bẩn.
 *
 * Giá phải trả là một bản sao logic; đổi lại, không có đường nào để token điều
 * khiển đi thẳng ra bong bóng chat. Với đúng thứ người dùng đang phàn nàn thì
 * đó là đánh đổi đáng.
 *
 * Chạy trên LUỒNG: một dấu hiệu có thể bị cắt đôi giữa hai chunk SSE, nên phần
 * đuôi chưa đủ để kết luận được GIỮ LẠI tới chunk sau. Không giữ thì chính cái
 * `<|` lẻ đó là thứ lọt ra màn hình.
 */

/** Kênh nào là "nói với người dùng". Mọi kênh khác coi là suy nghĩ nội bộ. */
const TEXT_CHANNELS = new Set(["", "final", "message", "output", "assistant"]);

/** Token điều khiển nuốt luôn phần chữ đi sau nó (`<|start|>assistant`). */
const SWALLOW_AFTER = new Set(["start", "constrain", "recipient", "to"]);

const MAX_MARKER_LEN = 16;

export type ChannelKind = "text" | "reasoning";
export type ChannelPiece = { kind: ChannelKind; text: string };

function looksLikePartialMarker(text: string): boolean {
  if (!text.startsWith("<")) return false;
  if (text.length > MAX_MARKER_LEN) return false;
  const low = text.toLowerCase();
  if (low.startsWith("<|")) return true; // đã chắc là dấu hiệu, chỉ chưa về hết
  return ["<|", "<think>", "</think>"].some((m) => m.startsWith(low));
}

function findSpace(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) return i;
  }
  return -1;
}

/** Tên kênh hợp lệ: định danh thường, ngắn (`analysis`, `final`, `thought`). */
function isChannelName(name: string): boolean {
  return name.length > 0 && name.length <= 24 && /^[a-z0-9_]+$/.test(name);
}

export class ChannelSplitter {
  private buf = "";
  private channel = "final";
  private pending: "channel" | "discard" | null = null;
  private name = "";

  reset(): void {
    this.buf = "";
    this.channel = "final";
    this.pending = null;
    this.name = "";
  }

  /** Nạp một mẩu token, trả về các phần đã CHẮC CHẮN thuộc kênh nào. */
  feed(delta: string): ChannelPiece[] {
    if (!delta) return [];
    this.buf += delta;
    return this.drain();
  }

  /** Chốt phần còn lại. Đuôi trông như dấu hiệu dở dang thì BỎ, không phát. */
  flush(): ChannelPiece[] {
    const out = this.drain();
    let rest = this.buf;
    this.buf = "";

    if (this.pending === "channel") {
      this.name += rest;
      rest = "";
      const piece = this.commitChannelName();
      if (piece) merge(out, piece);
    } else if (this.pending === "discard") {
      rest = "";
    }

    if (rest && !looksLikePartialMarker(rest)) {
      const piece = this.emit(rest);
      if (piece) merge(out, piece);
    }
    this.pending = null;
    this.name = "";
    return out;
  }

  private drain(): ChannelPiece[] {
    const out: ChannelPiece[] = [];

    while (this.buf) {
      if (this.pending === "channel" || this.pending === "discard") {
        let idx = this.buf.indexOf("<|");
        /* Tên kênh là MỘT TỪ. Kết thúc ở khoảng trắng đầu tiên nữa, vì có model
           phát `<|channel|>thought` rồi xuống dòng nói luôn, không kèm
           `<|message|>` — chỉ chờ `<|` thì cả câu sau đó bị nuốt làm tên kênh. */
        const space = findSpace(this.buf);
        if (space !== -1 && (idx === -1 || space < idx)) idx = space;

        if (idx === -1) {
          /* GIỮ LẠI dấu `<` ở cuối: rất có thể là nửa đầu của `<|message|>`
             đang về dở. Nuốt nó thì dấu hiệu kế không bao giờ khớp nữa. */
          const keep = this.buf.endsWith("<") ? 1 : 0;
          const consumed = this.buf.slice(0, this.buf.length - keep);
          if (this.pending === "channel") this.name += consumed;
          this.buf = this.buf.slice(consumed.length);
          break;
        }

        let piece: ChannelPiece | null = null;
        if (this.pending === "channel") {
          this.name += this.buf.slice(0, idx);
          piece = this.commitChannelName();
        }
        if (piece) merge(out, piece);
        // Kết bằng khoảng trắng thì nuốt luôn ký tự đó — trừ khi phần vừa đọc
        // hoá ra là CHỮ, lúc đó khoảng trắng cũng là chữ.
        const eat = idx === space && piece === null ? 1 : 0;
        this.buf = this.buf.slice(idx + eat);
        this.pending = null;
        this.name = "";
        continue;
      }

      const i = this.buf.indexOf("<");
      if (i === -1) {
        const piece = this.emit(this.buf);
        this.buf = "";
        if (piece) merge(out, piece);
        break;
      }
      if (i > 0) {
        const piece = this.emit(this.buf.slice(0, i));
        this.buf = this.buf.slice(i);
        if (piece) merge(out, piece);
      }

      if (this.buf.startsWith("<|")) {
        const j = this.buf.indexOf("|>", 2);
        if (j === -1) {
          if (this.buf.length <= MAX_MARKER_LEN) break; // chờ thêm, đừng đoán
          const piece = this.emit("<");
          this.buf = this.buf.slice(1);
          if (piece) merge(out, piece);
          continue;
        }
        const token = this.buf.slice(2, j).trim().toLowerCase();
        this.buf = this.buf.slice(j + 2);
        this.handleToken(token);
        continue;
      }

      const low = this.buf.toLowerCase();
      if (low.startsWith("<think>")) {
        this.channel = "analysis";
        this.buf = this.buf.slice(7);
        continue;
      }
      if (low.startsWith("</think>")) {
        this.channel = "final";
        this.buf = this.buf.slice(8);
        continue;
      }
      if (looksLikePartialMarker(this.buf)) break;

      const piece = this.emit("<");
      this.buf = this.buf.slice(1);
      if (piece) merge(out, piece);
    }

    return out;
  }

  private handleToken(token: string): void {
    if (token === "channel") {
      this.pending = "channel";
      this.name = "";
    } else if (token === "message") {
      this.pending = null;
    } else if (SWALLOW_AFTER.has(token)) {
      this.pending = "discard";
    } else if (token === "end" || token === "return") {
      // Hết một đoạn. Đoạn suy nghĩ luôn tự khai báo kênh, nên mặc định là nói.
      this.channel = "final";
      this.pending = null;
    }
    // Token lạ: bỏ im lặng — chuyện nội bộ của định dạng.
  }

  private commitChannelName(): ChannelPiece | null {
    const name = this.name.trim();
    this.name = "";
    if (!name) {
      this.channel = ""; // `<|channel|>` trần — coi như kênh nói.
      return null;
    }
    if (isChannelName(name)) {
      this.channel = name;
      return null;
    }
    /* Không phải tên kênh ⇒ `<|channel|>` đứng trần rồi model nói luôn. Đưa
       kênh về mặc định TRƯỚC khi phát, nếu không phần này vẫn bị xếp vào kênh
       suy nghĩ của đoạn trước. */
    this.channel = "";
    return this.emit(name);
  }

  private emit(text: string): ChannelPiece | null {
    if (!text) return null;
    return { kind: TEXT_CHANNELS.has(this.channel) ? "text" : "reasoning", text };
  }
}

function merge(out: ChannelPiece[], piece: ChannelPiece): void {
  const last = out[out.length - 1];
  if (last && last.kind === piece.kind) last.text += piece.text;
  else out.push(piece);
}

/** Bản một-phát cho chuỗi đã đủ: chỉ giữ phần lời nói.

    Dùng cho tin nhắn tải từ lịch sử — chúng đã được lưu nguyên văn, kể cả token
    điều khiển, nên cuộn lại phiên cũ vẫn thấy `<|channel|>` nếu không lọc. */
export function stripControlTokens(text: string): string {
  if (!text || (!text.includes("<|") && !text.toLowerCase().includes("<think"))) return text;
  const splitter = new ChannelSplitter();
  const pieces = [...splitter.feed(text), ...splitter.flush()];
  return pieces
    .filter((p) => p.kind === "text")
    .map((p) => p.text)
    .join("");
}

/** Phần suy nghĩ của một chuỗi đã đủ — dùng để dựng lại khối "Suy nghĩ" cho
    tin nhắn cũ đã lưu lẫn cả hai kênh vào `content`. */
export function extractReasoning(text: string): string {
  if (!text || (!text.includes("<|") && !text.toLowerCase().includes("<think"))) return "";
  const splitter = new ChannelSplitter();
  const pieces = [...splitter.feed(text), ...splitter.flush()];
  return pieces
    .filter((p) => p.kind === "reasoning")
    .map((p) => p.text)
    .join("");
}
