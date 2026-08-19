/* Trang gốc — chuyển thẳng vào màn hình Điều khiển.
 *
 * Bản gốc để một trang giới thiệu sản phẩm ở đây, với các nút dẫn sang
 * `/login`. Dự án này KHÔNG có xác thực: `server/main.py` chỉ phơi `/chat`,
 * `/go_home` và `/health` — không có `/auth/*`, không có người dùng, không có
 * token. Giữ trang đó lại nghĩa là mọi lần mở app đều đâm vào một cánh cửa
 * không bao giờ mở được.
 *
 * Nên `/` đi thẳng vào chỗ làm việc. Muốn dựng lại trang giới thiệu thì thêm
 * một route riêng (vd `/gioi-thieu`) — nhưng nó không được nằm chắn lối vào. */

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/control/new");
}
