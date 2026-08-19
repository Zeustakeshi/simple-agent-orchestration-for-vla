/* DisabledHint — MASTER §11.2

   §11.2 bắt buộc: nút bị khoá phải nêu lý do cụ thể, "không được chỉ xám đi".
   Nhưng đặt `title` thẳng lên `<button disabled>` thì lý do đó không bao giờ
   hiện — trình duyệt không gửi sự kiện chuột tới form control đang disabled,
   nên tooltip gốc bị nuốt. Người dùng chỉ thấy một nút xám không giải thích gì.

   Bọc nút bằng một thẻ có `title` thì tooltip mới bật, vì thẻ bọc không bị
   disabled. Khi nút đang bấm được thì component tan biến, không thêm thẻ thừa
   vào cây DOM. */

import type { ReactNode } from "react";

interface DisabledHintProps {
  /** Lý do nút bị khoá. Bỏ trống nghĩa là nút đang dùng được. */
  reason?: string;
  children: ReactNode;
  className?: string;
}

export function DisabledHint({ reason, children, className = "" }: DisabledHintProps) {
  if (!reason) return <>{children}</>;
  return (
    <span title={reason} className={`inline-flex ${className}`}>
      {children}
    </span>
  );
}
