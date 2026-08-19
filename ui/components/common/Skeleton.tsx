/* Skeleton — MASTER §14.1
   Shape must match the real content. animate-pulse is disabled by the
   global prefers-reduced-motion block in globals.css. */

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`bg-ink-700 rounded animate-pulse ${className}`} aria-hidden="true" />;
}

/** A card-shaped skeleton for robot/schedule grids. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3" />
      ))}
    </div>
  );
}

/** A table-row-shaped skeleton. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 h-12 px-3">
      <Skeleton className="h-5 w-14 rounded-full" />
      <Skeleton className="h-3 flex-1" />
      <Skeleton className="h-3 w-12" />
      <Skeleton className="h-5 w-20 rounded-full" />
    </div>
  );
}
