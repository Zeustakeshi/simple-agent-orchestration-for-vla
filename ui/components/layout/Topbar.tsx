"use client";
/* Topbar — P02
   breadcrumb · badge trạng thái robot · ⌘K + tài khoản. Không có bộ chọn
   robot — xem lý do ở khối bên dưới. */

import { usePathname } from "next/navigation";
import { PanelLeft, Search, Bell } from "lucide-react";
import { RobotStatusBadge } from "@/components/robot-state/RobotStatusBadge";
import { useAuthStore, type Robot } from "@/stores";

const ROUTE_LABELS: [prefix: string, label: string][] = [
  ["/dashboard", "Tổng quan"],
  ["/control", "Trò chuyện"],
  ["/sessions", "Nhật ký"],
  ["/schedules", "Lịch chạy"],
  ["/runs", "Nhật ký"],
  ["/robots", "Robot"],
  ["/settings", "Cài đặt"],
];

interface TopbarProps {
  /* Chỉ nhận robot ĐANG chọn, không nhận cả danh sách và cũng không nhận hàm
     đổi robot: topbar không còn là nơi chuyển robot nữa, nên giữ hai prop kia
     chỉ khiến người đọc sau tưởng nó vẫn làm việc đó. */
  selectedRobot: Robot | null;
  onMobileMenuOpen: () => void;
  onCommandPaletteOpen: () => void;
}

export function Topbar({
  selectedRobot,
  onMobileMenuOpen,
  onCommandPaletteOpen,
}: TopbarProps) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const current = ROUTE_LABELS.find(([prefix]) => pathname?.startsWith(prefix))?.[1] ?? "Tổng quan";

  return (
    <header className="h-14 shrink-0 border-b border-[var(--line)] bg-ink-900 px-4 sm:px-5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* <768px sidebar là sheet, nên ở đây chỉ còn việc mở sheet. Nút thu/mở
            của desktop nằm trên chính sidebar. */}
        <button
          type="button"
          onClick={onMobileMenuOpen}
          aria-label="Mở thanh điều hướng"
          className="md:hidden p-1.5 rounded-lg text-haze-300 hover:text-paper-50 hover:bg-ink-700 transition-colors duration-[120ms] focus-ring cursor-pointer shrink-0"
        >
          <PanelLeft size={18} />
        </button>

        <nav aria-label="Đường dẫn" className="text-[13px] truncate">
          <span className="text-haze-500">VAGENT</span>
          <span className="text-haze-500 mx-2" aria-hidden="true">
            /
          </span>
          <span className="text-paper-50 font-medium">{current}</span>
        </nav>
      </div>

      {/* KHÔNG có bộ chọn robot ở đây.

          Sản phẩm vận hành đúng MỘT cánh tay, nên một ô thả xuống liệt kê mọi
          robot chỉ mời người dùng đổi sang con họ không điều khiển. Cần đổi thì
          vào trang Robot — ở đó có đủ ngữ cảnh để chọn, còn topbar thì không.

          Trước đây ô này vẫn nằm trong code nhưng bị điều kiện `robots.length > 1`
          che đi: `mockRobots` lọc còn đúng một robot. Chuyển sang dữ liệu thật,
          backend trả 4 robot và ô thả xuống hiện ra — không phải thứ mới thêm,
          mà là thứ cũ lần đầu lộ diện.

          Badge trạng thái GIỮ LẠI: sau khi bỏ Telemetry Rail, đây là chỗ duy
          nhất còn bảo đảm "trạng thái robot luôn nhìn thấy được" (§2.1 ưu tiên
          2) — mà đó là thông tin an toàn, không phải trang trí. Cỡ thường chứ
          không phải sm, tên robot nằm trong `title` cho ai cần tra. */}
      {selectedRobot && (
        <div className="hidden sm:flex items-center shrink-0" title={selectedRobot.name}>
          <RobotStatusBadge
            robotStatus={selectedRobot.robot_status}
            connectionStatus={selectedRobot.connection_status}
          />
        </div>
      )}

      <div className="flex items-center gap-2 shrink-0">
        {/* Trông như một ô tìm kiếm, nhưng vẫn là nút mở bảng lệnh ⌘K (P02).
            Dưới sm thu về nút tròn chỉ còn icon để không chiếm chỗ của topbar. */}
        <button
          type="button"
          onClick={onCommandPaletteOpen}
          aria-label="Tìm kiếm và chạy lệnh"
          title="Tìm kiếm và chạy lệnh (⌘K)"
          className="inline-flex items-center gap-2 h-9 rounded-full border border-[var(--line)] bg-ink-800 text-haze-500 hover:text-haze-300 hover:border-[var(--line-strong)] transition-colors duration-[120ms] focus-ring cursor-pointer w-9 justify-center sm:w-auto sm:justify-start sm:px-3.5 lg:min-w-[200px]"
        >
          <Search size={15} className="shrink-0" />
          <span className="hidden sm:inline text-[13px]">Tìm kiếm</span>
        </button>
        <button
          type="button"
          aria-label="Thông báo"
          title="Thông báo"
          className="w-9 h-9 rounded-full flex items-center justify-center text-haze-300 hover:text-paper-50 hover:bg-ink-800 transition-colors duration-[120ms] focus-ring cursor-pointer"
        >
          <Bell size={18} />
        </button>
        {/* Avatar dùng viền kính. Không đặt bg-* ở đây: .liquid-glass khai báo
            ngoài @layer nên nó thắng utility của Tailwind và sẽ nuốt mất nền.
            Truyền màu qua chính biến của nó để giữ sắc xanh nhận diện. */}
        <span
          className="liquid-glass w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold text-arc-400"
          style={{ "--lg-tint": "rgb(11 103 224 / 0.22)" } as React.CSSProperties}
          title={user?.email ?? undefined}
        >
          {user?.name?.charAt(0).toUpperCase() ?? "U"}
        </span>
      </div>
    </header>
  );
}
