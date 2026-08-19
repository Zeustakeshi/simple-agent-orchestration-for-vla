"use client";
/* SafetyBanner — MASTER §12.2
   Solid red (never glass), role="alert" + aria-live="assertive", never
   auto-dismisses, and pushes content down instead of covering it. The close
   button exists but requires a deliberate press. */

import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { errorTextByCode } from "@/lib/errors";

interface SafetyBannerProps {
  errorCode: string;
  robotName: string;
  flags: string[];
}

export function SafetyBanner({ errorCode, robotName, flags }: SafetyBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const message = errorTextByCode(errorCode, "Robot báo lỗi an toàn. Kiểm tra thiết bị trước khi ra lệnh tiếp.");

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="shrink-0 bg-halt-500/12 border-b border-halt-500/40 px-4 sm:px-5 py-3 flex items-start gap-3"
    >
      <TriangleAlert size={18} className="text-halt-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 text-[13px] text-halt-500">
        <p>
          <span className="font-semibold">{robotName}</span> — {message}
        </p>
        {flags.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1.5">
            {flags.map((flag) => (
              <span key={flag} className="data text-[11px] px-1.5 py-0.5 rounded bg-halt-500/12">
                {flag}
              </span>
            ))}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Đóng cảnh báo an toàn"
        className="p-1 rounded-lg text-halt-500 hover:bg-halt-500/10 transition-colors duration-[120ms] focus-ring cursor-pointer shrink-0"
      >
        <X size={16} />
      </button>
    </div>
  );
}
