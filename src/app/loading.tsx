export default function Loading() {
  return (
    <div className="w-full space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="h-5 w-48 rounded bg-border" />
        <div className="mt-2 h-3 w-72 rounded bg-border/70" />
      </div>

      {/* KPI skeleton */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="h-3 w-24 rounded bg-border/70" />
            <div className="mt-3 h-7 w-32 rounded bg-border" />
            <div className="mt-3 h-2.5 w-20 rounded bg-border/70" />
          </div>
        ))}
      </div>

      {/* Panels skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm lg:col-span-2">
          <div className="h-4 w-40 rounded bg-border" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-3 rounded bg-border/70" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="h-4 w-32 rounded bg-border" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 rounded bg-border/70" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}