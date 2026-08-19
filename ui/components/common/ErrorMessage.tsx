"use client";
/* ErrorMessage — MASTER §14.3
   Never hardcode the Vietnamese string here: look it up by code. */

import { TriangleAlert } from "lucide-react";
import { errorText, type ErrorObject } from "@/lib/errors";
import { CopyableCode } from "./CopyableCode";

interface ErrorMessageProps {
  error: ErrorObject;
  /** Retry handler — rendered as an inline action next to the message. */
  onRetry?: () => void;
  className?: string;
}

export function ErrorMessage({ error, onRetry, className = "" }: ErrorMessageProps) {
  return (
    <div className={`flex items-start gap-2 text-[13px] text-halt-500 ${className}`}>
      <TriangleAlert size={16} className="mt-0.5 shrink-0" />
      <div className="flex flex-col gap-1 min-w-0">
        <span>{errorText(error)}</span>
        {error.trace_id && <CopyableCode value={error.trace_id} label="Mã tra cứu" />}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="self-start btn-ghost !h-7 !px-2 !text-[12px] !text-halt-500 hover:!bg-halt-500/10 focus-ring"
          >
            Thử lại
          </button>
        )}
      </div>
    </div>
  );
}

/** Page-level variant: the main query of a page failed — MASTER §14.3 row 3. */
export function ErrorPanel({ error, onRetry }: { error: ErrorObject; onRetry?: () => void }) {
  return (
    <div className="panel p-6 flex flex-col items-center gap-3 text-center">
      <ErrorMessage error={error} onRetry={onRetry} className="justify-center" />
    </div>
  );
}
