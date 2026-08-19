"use client";
/* Sidebar — P02 + MASTER §17
   ≥1280px: full 240px · 768–1279px: 64px icons with tooltips · <768px: sheet.
   The collapse is a media-query, not state, so it can't disagree with the
   viewport. Labels and icons come verbatim from MASTER §5.1. */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  MessageSquarePlus,
  MessagesSquare,
  CalendarClock,
  ScrollText,
  Settings2,
  ChevronUp,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useAuthStore,
  useUiPreferenceStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
} from "@/stores";
import { newSessionHref } from "@/lib/api/sessions";

/** Bước nhảy khi chỉnh bằng bàn phím — đủ lớn để thấy đổi ngay, đủ nhỏ để canh
    được. Kéo chuột thì liên tục, không theo bước. */
const RESIZE_STEP = 16;

/** Chỗ tối thiểu chừa lại cho cột nội dung khi kéo. Không có nó thì trên màn
    hình 768px, sidebar 400px nuốt hơn nửa bề ngang và khung chat còn 350px. */
const CONTENT_MIN_WIDTH = 520;

interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Prefix(es) used to decide the active state (a detail route stays active). */
  match: string | string[];
}

/* Chỉ các NƠI CHỐN nằm ở đây. "Phiên mới" là một hành động nên nó là nút riêng
   phía trên, không phải một dòng nav — trộn hành động vào giữa các đích đến thì
   người dùng phải đoán dòng nào dẫn đi đâu, dòng nào làm gì.

   Mục này lệch nhãn §5.1 ("Trò chuyện") thành "Lịch sử phiên", có chủ đích:
   nút "Phiên mới" ngay phía trên đã là chỗ để trò chuyện, nên mục nav bên dưới
   phải nói rõ nó là nơi xem LẠI.

   GỘP NHÁNH: develop đổi dòng này thành `href: "/control/new"` nhãn "Trò
   chuyện" — tức là biến mục xem lại thành nút tạo mới, đúng thứ đã bị bác một
   lần. Khôi phục bản này. Phần develop GIỮ LẠI là `match` nhận mảng, và ở đây
   dùng nó cho việc đúng của nó: đang trong một phiên chat (`/control/...`) thì
   mục "Lịch sử phiên" sáng lên, vì phiên chat nằm dưới đó. Không muốn sáng thì
   bỏ `"/control"` khỏi mảng, không đụng gì khác. */
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Tổng quan", Icon: LayoutGrid, match: "/dashboard" },
  { href: "/sessions", label: "Lịch sử phiên", Icon: MessagesSquare, match: ["/sessions", "/control"] },
  { href: "/schedules", label: "Lịch chạy", Icon: CalendarClock, match: "/schedules" },
  { href: "/runs", label: "Nhật ký", Icon: ScrollText, match: "/runs" },
  { href: "/settings", label: "Cài đặt", Icon: Settings2, match: "/settings" },
];

function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" aria-hidden="true">
      <path
        d="M 160 88 L 194 34 L 216 0 L 256 0 L 256 40 L 221.5 93.5 L 200 128 L 256 128 L 256 256 L 96 256 L 96 168 L 64.246 220 L 40 256 L 0 256 L 0 216 L 34 162 L 56 128 L 0 128 L 0 0 L 160 0 Z"
        fill="var(--paper-50)"
      />
    </svg>
  );
}

interface SidebarProps {
  /** Thu gọn về dải 64px. Chỉ áp cho ≥768px; dưới ngưỡng đó sidebar là sheet. */
  collapsed: boolean;
  /** Bỏ trống ở sheet mobile — ở đó nút đóng mới là thứ cần. */
  onToggleCollapsed?: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  /* Đọc bề rộng TẠI ĐÂY chứ không nhận qua prop từ `AppShellClient`. Nếu shell
     subscribe, mỗi khung hình lúc kéo sẽ render lại cả `{children}` — tức là
     toàn bộ trang đang mở. Ở đây thì chỉ mình sidebar render lại. */
  const storedWidth = useUiPreferenceStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiPreferenceStore((s) => s.setSidebarWidth);

  /* Lúc kéo, bề rộng sống ở state cục bộ và chỉ ghi vào store khi thả. Ghi mỗi
     `pointermove` thì kèm theo một lượt `localStorage.setItem` đồng bộ mỗi
     khung hình — đủ để cảm thấy rít tay. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = dragWidth !== null;
  const width = dragWidth ?? storedWidth;

  /* Trần thật lúc chạy: hằng số MAX, nhưng không bao giờ lấn vào phần tối thiểu
     của cột nội dung. Tính lúc kéo chứ không nhớ sẵn — người dùng đổi cỡ cửa sổ
     giữa chừng là chuyện thường. */
  const maxWidth = () =>
    Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - CONTENT_MIN_WIDTH));

  const commitWidth = (px: number) =>
    setSidebarWidth(Math.min(Math.max(px, SIDEBAR_MIN_WIDTH), maxWidth()));

  /* Khoá chọn văn bản trên toàn trang trong lúc kéo. Không có nó, kéo qua vùng
     nội dung sẽ bôi đen chữ dọc đường, và con trỏ nhấp nháy đổi hình mỗi lần đi
     qua một phần tử khác. */
  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const prevSelect = style.userSelect;
    const prevCursor = style.cursor;
    style.userSelect = "none";
    style.cursor = "col-resize";
    return () => {
      style.userSelect = prevSelect;
      style.cursor = prevCursor;
    };
  }, [dragging]);

  // Esc closes the mobile sheet.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onMobileClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen, onMobileClose]);

  /** Nút thu/mở nằm trên chính sidebar. Vì vậy trạng thái thu gọn phải là dải
      64px chứ không phải ẩn hẳn — ẩn hẳn thì mất luôn chỗ để bấm mở lại. */
  const toggleButton = (expanded: boolean) => (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-label={expanded ? "Thu gọn thanh điều hướng" : "Mở rộng thanh điều hướng"}
      aria-expanded={expanded}
      title={`${expanded ? "Thu gọn" : "Mở rộng"} thanh điều hướng (⌘B)`}
      /* Lúc thu gọn, nút lấy đúng hình học của một mục nav: cao 36px, rộng hết
         khung trong padding 8px, bo lg, icon 18px. Nhờ vậy vùng hover và tâm
         icon của nó thẳng hàng với các icon bên dưới thay vì lệch một chút. */
      className={`rounded-lg text-haze-500 hover:text-paper-50 hover:bg-ink-800 transition-colors duration-[120ms] focus-ring cursor-pointer shrink-0 ${
        expanded ? "p-1.5" : "w-full h-9 flex items-center justify-center"
      }`}
    >
      {expanded ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={18} strokeWidth={1.8} />}
    </button>
  );

  const content = (expanded: boolean) => (
    <div className="flex flex-col h-full">
      {expanded ? (
        <div className="h-14 flex items-center gap-1 shrink-0 pl-3 pr-2">
          {/* Logo dẫn về Tổng quan, không phải trang chủ: đang đăng nhập mà bấm
              logo rồi bị đẩy ra trang giới thiệu thì giống bị đá ra ngoài.
              Nút thu/mở đứng NGOÀI link — lồng nút trong link là bấm một chỗ ra
              hai hành vi. */}
          <Link
            href="/dashboard"
            onClick={onMobileClose}
            aria-label="VAGENT — về Tổng quan"
            className="flex items-center gap-2.5 flex-1 min-w-0 h-9 px-2 rounded-lg hover:bg-ink-800 transition-colors duration-[120ms] focus-ring"
          >
            <Logo size={20} />
            <span className="font-display text-[15px] font-semibold text-paper-50 tracking-tight truncate">
              VAGENT
            </span>
          </Link>
          {onToggleCollapsed && toggleButton(true)}
        </div>
      ) : (
        /* Logo giữ đúng ô cao 56px như lúc mở rộng, nên nó vẫn nằm cùng đường
           ngang với topbar dù sidebar đang thu. Nút thu/mở xuống dưới ô đó,
           cách ra hẳn — để chung một cụm sát nhau thì nhìn như hai logo. */
        <div className="flex flex-col items-center shrink-0">
          <div className="h-14 flex items-center">
            <Link
              href="/dashboard"
              onClick={onMobileClose}
              title="VAGENT — về Tổng quan"
              aria-label="VAGENT — về Tổng quan"
              className="p-1.5 rounded-lg hover:bg-ink-800 transition-colors duration-[120ms] focus-ring"
            >
              <Logo size={20} />
            </Link>
          </div>
          {/* px-2 giống hệt <nav> bên dưới, để nút rộng đúng bằng một mục nav.
              Không đệm đáy ở đây — khoảng hở xuống icon đầu tiên do <nav> lo,
              để nó bằng đúng gap giữa các icon với nhau. */}
          {onToggleCollapsed && <div className="w-full px-2">{toggleButton(false)}</div>}
        </div>
      )}

      {/* Hành động chính, tách hẳn khỏi danh sách nav và luôn nằm đúng một chỗ
          trên mọi trang — người dùng chỉ phải nhớ một vị trí. Develop đã bỏ nút
          này đi và nhét chức năng của nó vào một dòng nav; khôi phục.

          Thu gọn: cách nút thu/mở phía trên 8px, cách nhóm nav phía dưới 14px —
          ba cụm (logo+thu gọn · hành động · điều hướng) tách bạch nhau. */}
      <div className={expanded ? "px-3 pt-1 pb-3.5" : "px-2 pt-2 pb-3.5"}>
        {/* `?new=1` bắt buộc — develop đổi `/control/new` thành "mở lại phiên
            GẦN NHẤT", nên link trơn sẽ đưa nút "Phiên mới" về đúng cuộc trò
            chuyện cũ. `newSessionHref()` là helper của develop cho việc này,
            `CommandPalette` cũng đang dùng chính nó. */}
        <Link
          href={newSessionHref()}
          onClick={onMobileClose}
          title={expanded ? undefined : "Phiên mới"}
          className={`btn-primary w-full focus-ring ${expanded ? "" : "!px-0"}`}
        >
          <MessageSquarePlus size={16} strokeWidth={2} className="shrink-0" />
          {expanded && <span>Phiên mới</span>}
        </Link>
      </div>

      <nav
        aria-label="Điều hướng chính"
        /* gap-1 (4px) chứ không phải gap-0.5: dòng cao 36px với chữ 13px thì
           2px là quá sát, các nhãn gần như dính vào nhau. */
        className={`flex-1 flex flex-col gap-1 ${expanded ? "pb-2 px-3" : "pb-2 px-2"}`}
      >
        {NAV.map(({ href, label, Icon, match }) => {
          const prefixes = Array.isArray(match) ? match : [match];
          const active = prefixes.some((prefix) => pathname?.startsWith(prefix)) ?? false;
          return (
            <Link
              key={href}
              href={href}
              onClick={onMobileClose}
              title={expanded ? undefined : label}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-2.5 h-9 rounded-lg text-[13px] font-medium transition-colors duration-[120ms] focus-ring ${
                expanded ? "px-3" : "justify-center px-0"
              } ${active ? "bg-ink-700 text-paper-50" : "text-haze-300 hover:text-paper-50 hover:bg-ink-800"}`}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-arc-500" aria-hidden="true" />
              )}
              <Icon size={18} strokeWidth={1.8} className="shrink-0" />
              {expanded && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-[var(--line)] py-3 ${expanded ? "px-3" : "px-2"}`}>
        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          aria-expanded={userMenuOpen}
          title={expanded ? undefined : (user?.name ?? "Tài khoản")}
          className={`w-full flex items-center gap-2.5 h-9 rounded-lg text-[13px] font-medium text-haze-300 hover:text-paper-50 hover:bg-ink-800 transition-colors duration-[120ms] focus-ring cursor-pointer ${
            expanded ? "px-3" : "justify-center px-0"
          }`}
        >
          {/* Không đặt bg-* ở đây: .liquid-glass khai báo ngoài @layer nên nó
              thắng utility và sẽ nuốt mất nền. Màu đi qua biến của chính nó. */}
          <span
            className="liquid-glass w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-arc-400 shrink-0"
            style={{ "--lg-tint": "rgb(11 103 224 / 0.22)" } as React.CSSProperties}
          >
            {user?.name?.charAt(0).toUpperCase() ?? "U"}
          </span>
          {expanded && (
            <>
              <span className="flex-1 text-left truncate">{user?.name ?? "Người dùng"}</span>
              <ChevronUp size={14} className={userMenuOpen ? "" : "rotate-180"} />
            </>
          )}
        </button>

        {userMenuOpen && (
          <div className="mt-1 py-1">
            <Link
              href="/settings"
              onClick={() => {
                setUserMenuOpen(false);
                onMobileClose();
              }}
              className={`flex items-center gap-2.5 h-8 rounded-lg text-[12.5px] text-haze-300 hover:text-paper-50 hover:bg-ink-800 transition-colors duration-[120ms] focus-ring ${
                expanded ? "px-3" : "justify-center"
              }`}
            >
              <Settings2 size={14} />
              {expanded && "Cài đặt"}
            </Link>
            {/* Không có "Đăng xuất": dự án này không có phiên đăng nhập nào để
                kết thúc (xem `lib/local-user.ts`). Một nút hứa đăng xuất rồi
                chỉ tải lại trang là nói dối về việc có gì đang bảo vệ. */}
          </div>
        )}
      </div>
    </div>
  );

  /* Mép kéo. `role="separator"` có tabIndex là một widget hợp lệ và nhận được
     `aria-valuenow`, nên bàn phím và trình đọc màn hình đều hiểu — không phải
     một cái div bắt sự kiện chuột (§15).

     Nằm ĐÈ LÊN khe 8px giữa hai tấm chứ không lấn vào trong sidebar: vùng bắt
     rộng 8px mà không ăn mất pixel nào của nội dung. */
  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Kéo để đổi bề rộng thanh điều hướng"
      aria-valuenow={Math.round(width)}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title="Kéo để đổi bề rộng · nhấn đúp để về mặc định"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragWidth(width);
      }}
      onPointerMove={(e) => {
        if (dragWidth === null) return;
        /* Đo từ mép trái THẬT của sidebar, không giả định padding 8px của shell
           — đổi padding ở `AppShellClient` thì chỗ này vẫn đúng. */
        const left = asideRef.current?.getBoundingClientRect().left ?? 0;
        setDragWidth(Math.min(Math.max(e.clientX - left, SIDEBAR_MIN_WIDTH), maxWidth()));
      }}
      onPointerUp={(e) => {
        if (dragWidth === null) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        commitWidth(dragWidth);
        setDragWidth(null);
      }}
      /* Huỷ giữa chừng (Esc của hệ thống, gọi điện tới…) thì trả về giá trị đã
         lưu, không giữ nguyên chỗ tay vừa buông. */
      onPointerCancel={() => setDragWidth(null)}
      onDoubleClick={() => commitWidth(SIDEBAR_DEFAULT_WIDTH)}
      onKeyDown={(e) => {
        const delta =
          e.key === "ArrowLeft" ? -RESIZE_STEP : e.key === "ArrowRight" ? RESIZE_STEP : 0;
        if (delta !== 0) {
          e.preventDefault();
          commitWidth(width + delta);
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          commitWidth(SIDEBAR_MIN_WIDTH);
        } else if (e.key === "End") {
          e.preventDefault();
          commitWidth(maxWidth());
        }
      }}
      className="group absolute top-0 bottom-0 -right-2 z-10 w-2 cursor-col-resize touch-none focus-ring rounded-full"
    >
      {/* Vạch chỉ báo: ẩn khi rảnh để khe giữa hai tấm vẫn sạch, hiện khi rê
          vào hoặc đang kéo. `pointer-events-none` để nó không cướp con trỏ của
          chính mép kéo. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-3 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-arc-500 transition-opacity duration-[120ms] ${
          dragging ? "opacity-100" : "opacity-0 group-hover:opacity-60"
        }`}
      />
    </div>
  );

  return (
    <>
      {/* ≥768px: một cột duy nhất, rộng theo lựa chọn của người dùng (kéo mép
          phải) hoặc thu về 64px (mặc định lấy theo bề rộng màn hình lúc vào —
          §17). */}
      <aside
        ref={asideRef}
        /* Lúc thu gọn KHÔNG đặt style: để `w-16` quyết định, nếu không thì bề
           rộng đã kéo sẽ đè lên dải icon. */
        style={collapsed ? undefined : { width }}
        className={`liquid-glass liquid-glass--clear relative hidden md:flex flex-col shrink-0 h-full rounded-xl ${
          collapsed ? "w-16" : ""
        } ${
          /* Tắt transition trong lúc kéo: 320ms nghĩa là tấm kính chạy đuổi
             theo con trỏ chậm hơn một nhịp, cảm giác như tay bị trượt. */
          dragging ? "" : "transition-[width] duration-[320ms]"
        }`}
      >
        {content(!collapsed)}
        {!collapsed && resizeHandle}
      </aside>

      {/* <768px: sheet */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={onMobileClose} aria-hidden="true" />
          <aside
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Điều hướng"
            className="liquid-glass liquid-glass--surface absolute left-2 top-2 bottom-2 w-60 flex flex-col rounded-xl"
          >
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Đóng menu"
              className="absolute top-3 right-3 p-1.5 rounded-lg text-haze-300 hover:text-paper-50 hover:bg-ink-700 transition-colors duration-[120ms] focus-ring cursor-pointer"
            >
              <X size={18} />
            </button>
            {content(true)}
          </aside>
        </div>
      )}
    </>
  );
}
