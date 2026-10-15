import type { ReactNode } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";

export default function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand panel (desktop) */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-navy p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/10" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white/5" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-lg font-bold">F</div>
          <span className="text-lg font-bold tracking-tight">Finetax Manager</span>
        </div>

        <div className="relative max-w-md space-y-6">
          <h2 className="text-3xl font-bold leading-tight">
            Practice management for tax, accounting and compliance professionals.
          </h2>
          <ul className="space-y-3 text-sm text-muted">
            {[
              "Compliance tracking with internal and statutory deadlines",
              "Quotations, invoicing and receivables in one place",
              "Role-based access with a complete audit trail",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">Authorised personnel only. All activity is logged.</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-navy text-white shadow-sm lg:hidden">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-navy">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
          </div>

          {children}

          <p className="mt-10 text-center text-[11px] text-text-muted lg:hidden">
            Authorised personnel only. All activity is logged.
          </p>
        </div>
      </div>
    </div>
  );
}