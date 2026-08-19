"use client";
/* Dialog — MASTER §15
   Focus trap, focus first element on open, return focus to trigger on close,
   aria-modal, Esc to close. Used only for destructive confirmations and forms
   (MASTER §12.3 — never for the Halt button). */

import { useEffect, useRef, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Blocks click-outside close — used while a pairing code is on screen (P11). */
  disableOutsideClose?: boolean;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  disableOutsideClose = false,
  className = "",
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Remember what had focus so we can give it back on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      // Focus the first focusable element inside the panel.
      const id = requestAnimationFrame(() => {
        const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? panelRef.current)?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    triggerRef.current?.focus?.();
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      // Focus trap
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={handleKeyDown}>
      <div
        className="absolute inset-0 bg-black/60"
        onClick={disableOutsideClose ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`liquid-glass liquid-glass--strong rounded-xl relative w-full max-w-[480px] max-h-[90vh] overflow-y-auto outline-none ${className}`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)] sticky top-0 dialog-bar z-10">
          <h2 className="title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="p-1.5 rounded-lg text-haze-300 hover:text-paper-50 hover:bg-ink-700 transition-colors duration-[120ms] focus-ring cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">{children}</div>

        {footer && (
          <div className="px-5 py-4 border-t border-[var(--line)] flex justify-end gap-2 sticky bottom-0 z-10 dialog-bar">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Destructive confirmation — MASTER §12.3. Optionally requires typing a phrase. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  requirePhrase,
  typedValue,
  onTypedValueChange,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** When set, the confirm button stays disabled until the user types this exactly. */
  requirePhrase?: string;
  typedValue?: string;
  onTypedValueChange?: (v: string) => void;
}) {
  const confirmDisabled = requirePhrase ? typedValue !== requirePhrase : false;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost focus-ring">
            Huỷ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            title={confirmDisabled ? `Gõ đúng "${requirePhrase}" để tiếp tục.` : undefined}
            /* `halt-600` làm nền, KHÔNG phải `halt-500`. Hai token này khác vai
               và ghi rõ trong globals.css: `halt-500` là màu CHỮ lỗi trên nền
               tối, `halt-600` là nền nút có chữ trắng đè lên.
               Dùng nhầm thì ở theme tối `halt-500` = #FF5A52, chữ trắng chỉ đạt
               3.07:1 — trượt AA, mà tối lại là chế độ mặc định. Buồn cười là
               `hover:bg-halt-600` cũ làm nút DỄ đọc hơn khi rê chuột: 5.33:1.
               Giờ 5.33 lúc thường, 7.35 khi hover. HaltButton vốn đã đúng. */
            className="h-9 px-4 rounded-lg bg-halt-600 text-white text-[13px] font-medium hover:bg-halt-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-[120ms] focus-ring cursor-pointer"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="body-text text-haze-300">{description}</p>
      {requirePhrase && (
        <label className="block mt-4">
          <span className="text-[13px] text-paper-50">
            Gõ <span className="data text-paper-50">{requirePhrase}</span> để xác nhận
          </span>
          <input
            type="text"
            value={typedValue ?? ""}
            onChange={(e) => onTypedValueChange?.(e.target.value)}
            placeholder={requirePhrase}
            className="mt-1.5 w-full h-10 px-3 bg-ink-900 border border-[var(--line)] rounded-lg text-[13px] text-paper-50 placeholder:text-haze-500 focus:outline-none focus:border-halt-500 focus-ring"
          />
        </label>
      )}
    </Dialog>
  );
}
