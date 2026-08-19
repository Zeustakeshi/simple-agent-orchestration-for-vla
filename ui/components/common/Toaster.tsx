"use client";
/* Toaster — MASTER §14.3 row 1
   Bottom-right, auto-dismiss after 5s. Solid surface, never glass (§9.2). */

import { useEffect } from "react";
import { Check, TriangleAlert, Info, X } from "lucide-react";
import { useToastStore, type Toast } from "@/stores";

const TONE = {
  success: { Icon: Check, className: "text-jade-400" },
  error: { Icon: TriangleAlert, className: "text-halt-500" },
  info: { Icon: Info, className: "text-haze-300" },
} as const;

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const { Icon, className } = TONE[toast.tone];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);

  return (
    <div className="panel px-3.5 py-3 flex items-start gap-2.5 min-w-[260px] max-w-[380px] pointer-events-auto">
      <Icon size={16} className={`mt-0.5 shrink-0 ${className}`} />
      <span className="flex-1 text-[13px] text-paper-50">{toast.message}</span>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Đóng thông báo"
        className="p-0.5 rounded text-haze-500 hover:text-paper-50 transition-colors duration-[120ms] focus-ring cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} />
      ))}
    </div>
  );
}
