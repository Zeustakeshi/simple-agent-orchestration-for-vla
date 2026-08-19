/* EmptyState — MASTER §14.2
   Say what is missing and what to do next. No apology, no joke, no mascot. */

import type { ReactNode } from "react";

interface EmptyStateProps {
  /** What is missing, as a full sentence. */
  message: string;
  /** The single next action, if there is one. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ message, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`panel p-8 flex flex-col items-center justify-center gap-4 text-center ${className}`}>
      <p className="text-[14px] text-haze-300">{message}</p>
      {action}
    </div>
  );
}
