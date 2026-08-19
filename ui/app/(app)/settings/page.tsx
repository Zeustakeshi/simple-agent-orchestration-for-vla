"use client";
/* P11 — CÀI ĐẶT
   Vertical section nav on the left, 720px content on the right.
   Destructive actions (logging every device out) sit behind a confirmation;
   the pairing dialog refuses to close on an outside click while a code is
   live, so the code can't be lost by a stray click. */

import { useState } from "react";
import { User, Bell, Palette, Monitor, Moon, Sun } from "lucide-react";

import { Switch } from "@/components/common/Switch";
import { toast, useAuthStore, useUiPreferenceStore, type ThemePreference } from "@/stores";

const SECTIONS = [
  { key: "profile", label: "Hồ sơ", Icon: User },
  { key: "appearance", label: "Giao diện", Icon: Palette },
  { key: "notifications", label: "Thông báo", Icon: Bell },
] as const;

/* Dark stays the default (MASTER §1 mục 6); light is an explicit opt-in. */
/** Múi giờ hay dùng. Danh sách đầy đủ của IANA có hơn 400 mục — thừa cho một
    phòng lab, và một select dài như vậy khó chọn hơn là gõ. */
const TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string; Icon: typeof Monitor }[] = [
  { value: "system", label: "Theo hệ thống", hint: "Đổi theo cài đặt sáng/tối của máy.", Icon: Monitor },
  { value: "dark", label: "Tối", hint: "Mặc định — hợp với phòng lab tắt đèn khi xem camera.", Icon: Moon },
  { value: "light", label: "Sáng", hint: "Nền giấy, hợp với phòng nhiều ánh sáng.", Icon: Sun },
];

type SectionKey = (typeof SECTIONS)[number]["key"];


/* ---------------------------------------------------------------- page */

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [section, setSection] = useState<SectionKey>("profile");
  const [notifyOnScheduleFailure, setNotifyOnScheduleFailure] = useState(true);
  const [displayName, setDisplayName] = useState(user?.name ?? "");
  const [timezone, setTimezone] = useState(user?.timezone ?? "");

  /* `user` về theo đường bất đồng bộ (refreshSession ở app shell). Nếu trang này
     mount trước khi có user thì giá trị khởi tạo của useState là chuỗi rỗng và
     nó KẸT rỗng mãi — ô nhập trống trong khi header vẫn hiện tên.

     Chỉnh state NGAY TRONG RENDER thay vì trong effect. Đây là cách React
     khuyến nghị cho "state bám theo một prop đổi", và cũng đúng mẫu `lastPrefill`
     trong `Composer`. Effect chạy sau khi vẽ xong nên ô nhập nháy rỗng một
     khung hình rồi mới điền — chính vì vậy luật lint mới chặn setState đồng bộ
     trong effect. Chốt theo `user.id` nên gõ sửa tên xong không bị ghi đè. */
  const [lastUserId, setLastUserId] = useState(user?.id);
  if (user && user.id !== lastUserId) {
    setLastUserId(user.id);
    setDisplayName(user.name);
    setTimezone(user.timezone);
  }
  const theme = useUiPreferenceStore((s) => s.theme);
  const setTheme = useUiPreferenceStore((s) => s.setTheme);

  const saveProfile = () => {
    if (!user) return;
    setUser({
      ...user,
      name: displayName.trim() || user.name,
      timezone: timezone || user.timezone,
    });
    toast.success("Đã lưu thay đổi.");
  };

  return (
    <div className="flex flex-col md:flex-row">
      {/* Section nav */}
      <nav
        aria-label="Mục cài đặt"
        className="md:w-[200px] shrink-0 md:border-r border-b md:border-b-0 border-[var(--line)] p-3 md:sticky md:top-0 md:h-[calc(100vh-56px)]"
      >
        <ul className="flex md:flex-col gap-1 overflow-x-auto">
          {SECTIONS.map(({ key, label, Icon }) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => setSection(key)}
                aria-current={section === key ? "true" : undefined}
                className={`w-full flex items-center gap-2.5 h-9 px-3 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors duration-[120ms] focus-ring cursor-pointer ${
                  section === key ? "bg-ink-700 text-paper-50" : "text-haze-300 hover:text-paper-50 hover:bg-ink-800"
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex-1 p-4 sm:p-6 max-w-[720px] space-y-6">
        <h1 className="display-l text-paper-50">Cài đặt</h1>

        {section === "profile" && (
          <section className="space-y-4">
            <div className="panel p-5 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-arc-500/20 flex items-center justify-center text-[20px] font-semibold text-arc-400 shrink-0">
                  {user?.name?.charAt(0).toUpperCase() ?? "U"}
                </div>
                <div className="min-w-0">
                  <p className="title text-[16px] truncate">{user?.name}</p>
                  <p className="text-[13px] text-haze-500 truncate">{user?.email}</p>
                </div>
              </div>

              <label className="block">
                <span className="text-[13px] text-paper-50">Tên hiển thị</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1.5 w-full h-10 px-3 rounded-lg bg-ink-900 border border-[var(--line)] text-[13px] text-paper-50 focus:outline-none focus-ring"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-[13px] text-paper-50">Email</span>
                  <input
                    type="email"
                    value={user?.email ?? ""}
                    readOnly
                    aria-readonly="true"
                    className="mt-1.5 w-full h-10 px-3 rounded-lg bg-ink-900 border border-[var(--line)] text-[13px] text-haze-500 focus:outline-none cursor-not-allowed"
                  />
                  {/* Ô xám mà không nói lý do thì người dùng tưởng hỏng. */}
                  <span className="eyebrow normal-case tracking-normal mt-1 block">
                    Lấy từ tài khoản Google, không sửa ở đây được
                  </span>
                </label>
                <label className="block">
                  <span className="text-[13px] text-paper-50">Múi giờ</span>
                  {/* P11 xếp múi giờ vào nhóm SỬA ĐƯỢC, chỉ email mới readonly.
                      Nó cũng không phải thiết lập trang trí: mọi mốc thời gian
                      trong app đều quy theo giá trị này (§20). */}
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="mt-1.5 w-full h-10 px-3 rounded-lg bg-ink-900 border border-[var(--line)] data text-paper-50 focus:outline-none focus-ring cursor-pointer"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={saveProfile} className="btn-primary focus-ring">
                Lưu thay đổi
              </button>
            </div>
          </section>
        )}

        {section === "appearance" && (
          <section className="panel p-5 space-y-3">
            <h2 className="eyebrow">Chủ đề màu</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {THEME_OPTIONS.map((option) => {
                const active = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setTheme(option.value);
                      toast.success("Đã đổi giao diện.");
                    }}
                    aria-pressed={active}
                    className={`p-3 rounded-lg border text-left transition-colors duration-[120ms] focus-ring cursor-pointer ${
                      active
                        ? "bg-arc-500/12 border-arc-500/40"
                        : "bg-ink-900 border-[var(--line)] hover:border-[var(--line-strong)]"
                    }`}
                  >
                    <span className={`flex items-center gap-2 text-[13px] font-medium ${active ? "text-arc-400" : "text-paper-50"}`}>
                      <option.Icon size={15} />
                      {option.label}
                    </span>
                    <span className="block text-[12px] text-haze-500 mt-1">{option.hint}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-haze-500">
              Lựa chọn được lưu trên trình duyệt này. Trang chủ luôn giữ nền tối vì có video nền.
            </p>
          </section>
        )}

        {/* KHÔNG có mục "Robot" ở Cài đặt.

            Sản phẩm vận hành đúng MỘT cánh tay, nên một danh sách liệt kê mọi
            robot đã ghép nối chỉ đúng với một đội thiết bị — mà đây không phải.
            Thông tin từng con (model, phiên bản Edge, trạng thái) đã có đầy đủ
            ở trang Robot, nơi có ngữ cảnh để đọc nó; nhắc lại ở Cài đặt là chỗ
            thứ hai chứa cùng một thứ và sẽ lệch nhau khi một bên đổi.

            Mục này chỉ lộ ra khi chuyển sang dữ liệu thật: `mockRobots` lọc còn
            đúng một robot nên danh sách trông như một dòng thông tin, backend
            thật trả 4 con thì nó thành một danh sách thiết bị. */}

        {section === "notifications" && (
          <section className="panel p-5">
            <label className="flex items-start justify-between gap-4 cursor-pointer">
              <span>
                <span className="block text-[14px] text-paper-50">Báo khi lịch chạy thất bại</span>
                <span className="block text-[13px] text-haze-500 mt-0.5">
                  Nhận email khi một lịch chạy kết thúc với trạng thái thất bại.
                </span>
              </span>
              <Switch
                checked={notifyOnScheduleFailure}
                onChange={() => {
                  setNotifyOnScheduleFailure((v) => !v);
                  toast.success("Đã lưu tuỳ chọn thông báo.");
                }}
                label="Báo khi lịch chạy thất bại"
              />
            </label>
          </section>
        )}

        {/* Mục "Phiên đăng nhập" đã bị gỡ cùng với xác thực: không có phiên
            nào tồn tại để mà liệt kê hay huỷ (xem `lib/local-user.ts`). */}
      </div>


    </div>
  );
}
