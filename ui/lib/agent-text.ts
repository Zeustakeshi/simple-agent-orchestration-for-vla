/* Dọn token điều khiển của model khỏi chữ trước khi nó ra màn hình.
 *
 * Bộ tách THẬT nằm ở backend (`server/harmony.py`): chỉ ở đó mới nhìn được cả
 * luồng và ghép lại được dấu hiệu bị cắt đôi giữa hai chunk SSE, và cũng chỉ ở
 * đó mới tách được suy nghĩ ra khỏi lời nói thay vì xoá đi.
 *
 * File này là HÀNG RÀO THỨ HAI, cố ý ngu hơn: một biểu thức chính quy trên chuỗi
 * đã đủ. Nó có mặt vì hai đường vào mà backend không đứng chắn được —
 *
 *   · lịch sử hội thoại đã lưu từ trước khi có bộ tách;
 *   · một model lạ phát biến thể dấu hiệu chưa gặp.
 *
 * Cả hai đều dẫn tới đúng một cảnh: `<|channel|>thought` nằm chình ình giữa câu
 * trả lời trong bong bóng chat.
 */

/** `<|channel|>final`, `<|start|>assistant` — dấu hiệu KÈM phần chữ đi ngay sau
    nó. Phải xoá thành một cụm, và phải xoá TRƯỚC `CONTROL_TOKEN`: bỏ riêng dấu
    hiệu thì tên kênh (`final`, `analysis`) ở lại và dính vào đầu câu trả lời —
    "finalXong rồi.".

    Chỉ nuốt một định danh thường, ngắn. Chữ thật của model không bao giờ có
    dạng đó ngay sau một token điều khiển. */
const CONTROL_TOKEN_WITH_NAME = /<\|(?:channel|start|recipient|to|constrain)\|>[a-z0-9_.\-]{0,24}/gi;

/** `<|message|>`, `<|end|>`… — token đứng một mình. */
const CONTROL_TOKEN = /<\|[^|]*\|>/g;

/** `<think>` / `</think>` — DeepSeek-R1, Qwen. */
const THINK_TAG = /<\/?think>/gi;

/** Một dấu hiệu bị cắt cụt ở CUỐI chuỗi (`...<|chan`).

    Chỉ ở cuối, và chỉ khi phần đuôi ngắn: giữa câu thì `<|` gần như chắc chắn là
    chữ thật, và cắt nhầm nội dung còn tệ hơn để lọt một token. */
const TRAILING_PARTIAL = /<\|[^|>]{0,24}$/;

/** Trả về phần chữ đọc được, đã bỏ mọi token điều khiển.

    Thuần và giữ nguyên khoảng trắng: nó chạy trên TỪNG MẨU của luồng token, nên
    `trim()` ở đây sẽ nuốt mất dấu cách giữa hai từ nằm ở hai mẩu khác nhau. */
export function stripControlTokens(text: string): string {
  if (!text) return "";
  if (!text.includes("<")) return text; // đường tắt cho tuyệt đại đa số mẩu
  return text.replace(CONTROL_TOKEN_WITH_NAME, "").replace(CONTROL_TOKEN, "").replace(THINK_TAG, "").replace(TRAILING_PARTIAL, "");
}

/** Chuỗi này có còn gì để đọc sau khi dọn không?

    Dùng để KHÔNG mở một bong bóng rỗng cho một tin nhắn vốn chỉ có token điều
    khiển — đúng cái ô trống lơ lửng trong ảnh chụp màn hình. */
export function hasVisibleText(text: string | undefined | null): boolean {
  return stripControlTokens(text ?? "").trim().length > 0;
}
