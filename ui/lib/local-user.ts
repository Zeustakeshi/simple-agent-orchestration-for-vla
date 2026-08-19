import type { User } from "@/stores";

/** Danh tính cục bộ cố định — dự án này không có xác thực.
 *
 * `server/main.py` phơi ra đúng ba đường: `/chat`, `/go_home`, `/health`. Không
 * có `/auth/*`, không có người dùng, không có token. Đối tượng này chỉ để
 * sidebar có tên mà hiện và giao diện có múi giờ mà định dạng giờ — nó KHÔNG
 * cấp quyền cho bất cứ thứ gì, vì không có gì để cấp.
 *
 * Muốn xác thực thật thì phải thêm ở phía server trước; đặt một cổng đăng nhập
 * ở client mà backend không kiểm tra gì thì chỉ tạo cảm giác an toàn giả. */
export const LOCAL_USER: User = {
  id: "local",
  name: "Phòng Lab",
  email: "lab@example.io",
  avatar_url: null,
  timezone: "Asia/Ho_Chi_Minh",
};
