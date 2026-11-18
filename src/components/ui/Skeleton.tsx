/** Placeholder rows shown while a list loads, shaped like the rows that will replace them. */
export function ListSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-border">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5" style={{ opacity: 1 - i * 0.12 }}>
          <div className="skeleton h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3 w-2/5" />
            <div className="skeleton h-2.5 w-1/4" />
          </div>
          <div className="hidden w-24 space-y-2 sm:block">
            <div className="skeleton ml-auto h-3 w-16" />
            <div className="skeleton ml-auto h-2.5 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}
