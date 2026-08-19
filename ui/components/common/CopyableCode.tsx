"use client";
/* CopyableCode — MASTER §14.3
   Monospace value + copy button. Icon becomes a check for 1.5s after copying. */

import { useState, useRef, useEffect, useCallback } from "react";
import { Copy, Check } from "lucide-react";

interface CopyableCodeProps {
  value: string;
  label?: string;
  className?: string;
}

export function CopyableCode({ value, label, className = "" }: CopyableCodeProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — leave the value visible for manual selection */
    }
  }, [value]);

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {label && <span className="eyebrow">{label}</span>}
      <code className="data text-[11.5px] text-haze-300">{value}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Đã sao chép" : `Sao chép ${label ?? "giá trị"}`}
        className="p-1 rounded text-haze-500 hover:text-paper-50 hover:bg-ink-700 transition-colors duration-[120ms] focus-ring cursor-pointer"
      >
        {copied ? <Check size={12} className="text-jade-400" /> : <Copy size={12} />}
      </button>
    </span>
  );
}
