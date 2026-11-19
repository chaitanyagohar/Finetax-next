/**
 * Shared building blocks for page layouts, so every screen has the same header, cards,
 * figures and empty states. Server- and client-safe (no hooks).
 */
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyArt } from "@/components/ui/Decor";

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-navy px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-navy-light disabled:opacity-60",
  accent:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:brightness-95 disabled:opacity-60",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-text-main hover:bg-surface-alt disabled:opacity-60",
  ghost: "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-text-muted hover:bg-surface-alt hover:text-text-main disabled:opacity-60",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60",
};

export const field = {
  input:
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main shadow-sm outline-none placeholder:text-text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:bg-surface-alt disabled:text-text-muted",
  label: "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted",
};

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="hero-card rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-text-main">
            <Icon className="h-5 w-5 shrink-0 text-navy" /> {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </div>
  );
}

export function Card({ title, icon: Icon, action, children, className = "", bodyClassName = "p-4" }: {
  title?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-border bg-surface shadow-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-main">
            {Icon && <Icon className="h-4 w-4 text-text-muted" />}
            {title}
          </h3>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const TONES = {
  default: { value: "text-text-main", chip: "bg-surface-alt text-text-muted" },
  accent: { value: "text-accent", chip: "bg-accent-soft text-accent" },
  good: { value: "text-emerald-700", chip: "bg-emerald-50 text-emerald-600" },
  warn: { value: "text-amber-700", chip: "bg-amber-50 text-amber-600" },
  bad: { value: "text-rose-600", chip: "bg-rose-50 text-rose-600" },
  info: { value: "text-indigo-700", chip: "bg-indigo-50 text-indigo-600" },
} as const;

export type Tone = keyof typeof TONES;

export function Stat({ label, value, hint, icon: Icon, tone = "default", href }: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  href?: string;
}) {
  const t = TONES[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
        {Icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.chip}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${t.value}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-text-muted">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-border bg-surface p-4 shadow-sm";
  return href ? (
    <Link href={href} className={`${cls} hover:border-accent/40`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Pill({ children, tone = "default", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONES[tone].chip} ${className}`}>{children}</span>;
}

export function EmptyState({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <EmptyArt className="h-20 w-28" />
      <p className="text-sm font-semibold text-text-main">{title}</p>
      {hint && <p className="max-w-sm text-xs text-text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Thin progress bar; value 0..1 */
export function Meter({ value, tone = "accent" }: { value: number; tone?: "accent" | "good" | "warn" | "bad" }) {
  const color = { accent: "bg-accent", good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-rose-500" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
      <div className={`h-full rounded-full ${color} transition-[width] duration-500`} style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export const ROW_PAGE = 100;

/** "Show more" under long lists, so a firm with thousands of rows doesn't draw them all at once. */
export function ShowMore({ total, shown, onMore }: { total: number; shown: number; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-t border-border px-4 py-3 text-[11px] text-text-muted">
      Showing {shown.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      <button type="button" onClick={onMore} className={btn.secondary}>
        Show {Math.min(ROW_PAGE, total - shown)} more
      </button>
    </div>
  );
}
