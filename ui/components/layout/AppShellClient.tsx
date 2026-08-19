"use client";
/* AppShellClient — P02
   The interactive half of the (app) layout, kept out of the Server Component
   layout.tsx (MASTER §18.1). Owns: sidebar, topbar, safety banner slot,
   ⌘K palette, and the global "Esc Esc" emergency stop.

   Không còn Telemetry Rail: nội dung trùng Tổng quan; trạng thái robot vẫn
   thấy trên topbar. */

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { SafetyBanner } from "./SafetyBanner";
import { CommandPalette } from "./CommandPalette";
import { fetchRobots, stopRobot } from "@/lib/api/robots";
import { errorText, toErrorObject } from "@/lib/errors";
import { LOCAL_USER } from "@/lib/local-user";
import { useAuthStore, useRealtimeStore, useUiPreferenceStore, hydrateUiPreferences, toast, type Robot } from "@/stores";

const ESC_ESC_WINDOW_MS = 400;
const ROBOT_POLL_MS = 15_000;

/** Safety error flags that raise the assertive banner — MASTER §12.2. */
const SAFETY_FLAGS = ["ROBOT_021", "ROBOT_022", "ROBOT_023", "OVERLOAD", "JOINT_LIMIT", "OVERHEAT"];

export function AppShellClient({ children }: { children: ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [robots, setRobots] = useState<Robot[]>([]);

  const selectedRobotId = useAuthStore((s) => s.selectedRobotId);
  const liveRobotState = useRealtimeStore((s) => s.robotState);
  const sidebarCollapsed = useUiPreferenceStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiPreferenceStore((s) => s.toggleSidebar);
  const lastEscRef = useRef(0);

  /* Không có bước đăng nhập nào.
   *
   * Bản gốc gọi `bootstrapSession()` rồi đẩy sang `/login` khi Cloud trả 401.
   * `server/main.py` của dự án này không có `/auth/*`, không có người dùng và
   * không có token — nên lần gọi đó chỉ có thể thất bại, và cánh cửa nó đẩy
   * người dùng tới thì không bao giờ mở được.
   *
   * Danh tính ở đây là cục bộ và cố định: nó chỉ dùng để hiện tên trong sidebar
   * và chọn múi giờ. Không có gì được bảo vệ sau nó, và giao diện KHÔNG được
   * giả vờ ngược lại — vì thế mọi lối "Đăng xuất" cũng đã bị gỡ, thay vì để lại
   * một nút hứa kết thúc một phiên vốn không tồn tại. */
  useEffect(() => {
    hydrateUiPreferences();
    if (!useAuthStore.getState().user) {
      useAuthStore.getState().setUser(LOCAL_USER);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchRobots()
        .then((data) => {
          if (cancelled) return;
          setRobots(data);
          if (!useAuthStore.getState().selectedRobotId && data.length > 0) {
            useAuthStore.getState().selectRobot(data[0].id);
          }
        })
        .catch(() => undefined);
    };
    load();
    const interval = setInterval(load, ROBOT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const selectedRobot = robots.find((r) => r.id === selectedRobotId) ?? null;
  const effectiveStatus = liveRobotState?.robot_status ?? selectedRobot?.robot_status ?? "IDLE";

  /* ---- Esc Esc → emergency stop (MASTER §12.1) ---- */
  const emergencyStop = useCallback(() => {
    const robot = robots.find((r) => r.id === useAuthStore.getState().selectedRobotId);
    if (!robot) return;
    stopRobot(robot.id)
      .then(() => toast.success(`Đã gửi lệnh dừng ${robot.name}.`))
      .catch((err) => toast.error(errorText(toErrorObject(err))));
  }, [robots]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const now = Date.now();
        if (now - lastEscRef.current < ESC_ESC_WINDOW_MS && effectiveStatus === "BUSY") {
          lastEscRef.current = 0;
          emergencyStop();
        } else {
          lastEscRef.current = now;
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // ⌘B / Ctrl+B — thu gọn navbar, quen tay từ các app cùng loại.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [emergencyStop, effectiveStatus, toggleSidebar]);

  /* ---- safety banner ---- */
  const safetyFlag = selectedRobot?.health.error_flags.find((flag) => SAFETY_FLAGS.includes(flag));

  /* Không còn màn hình "Đang xác thực phiên…". Nó tồn tại để che khoảng chờ
     `/me` trả lời; ở đây danh tính là hằng số nên chẳng có gì để chờ, và một
     màn hình chờ nháy qua rồi biến mất chỉ làm app khởi động trông giật. */

  return (
    /* Hai tấm nổi trên nền lưới, cách nhau 8px: cột trái TRONG SUỐT — chỉ còn
       viền, lưới xuyên qua sắc nét — còn cột phải bằng kính đục để dữ liệu vận
       hành luôn đọc rõ. Cùng bo góc, cùng kiểu viền. */
    <div className="app-shell-bg flex h-screen overflow-hidden gap-2 p-2">
      {/* Không truyền `robot` xuống Sidebar: develop cho sidebar hiện trạng
          thái robot, nhưng ở bản này trạng thái đó nằm trên Topbar (§2.1 ưu
          tiên 2). Để cả hai chỗ cùng hiện thì hai chấm trạng thái có thể lệch
          nhau, mà đây là thông tin an toàn. */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <div className="glass-edge flex-1 flex flex-col min-w-0 overflow-hidden rounded-xl border border-[var(--line)]">
        <Topbar
          selectedRobot={selectedRobot}
          onMobileMenuOpen={() => setMobileMenuOpen(true)}
          onCommandPaletteOpen={() => setPaletteOpen(true)}
        />

        {/* Pushes content down, never overlays it (MASTER §12.2) */}
        {safetyFlag && selectedRobot && (
          <SafetyBanner
            errorCode={safetyFlag}
            robotName={selectedRobot.name}
            flags={selectedRobot.health.error_flags}
          />
        )}

        <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} robots={robots} />}
    </div>
  );
}
