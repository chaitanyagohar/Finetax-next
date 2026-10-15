"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { getPasswordStrength } from "@/lib/password";

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  autoComplete?: "current-password" | "new-password";
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  showStrength?: boolean;
  hint?: string;
}

export default function PasswordInput({
  value,
  onChange,
  id,
  name,
  label,
  placeholder = "••••••••",
  autoComplete = "current-password",
  required = false,
  autoFocus = false,
  disabled = false,
  showStrength = false,
  hint,
}: PasswordInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const strength = showStrength ? getPasswordStrength(value) : null;

  return (
    <div>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </label>
      )}

      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
          onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
          autoComplete={autoComplete}
          required={required}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface py-2.5 pl-10 pr-10 text-sm shadow-sm outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/15 disabled:bg-surface-alt"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          onMouseDown={(e) => e.preventDefault()}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-muted transition hover:text-text-main"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {capsLock && <p className="mt-1.5 text-[11px] font-medium text-amber-600">Caps Lock is on.</p>}

      {strength && value && (
        <div className="mt-2" aria-live="polite">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-1 flex-1 rounded-full ${i <= strength.score ? strength.barClass : "bg-border"}`} />
            ))}
          </div>
          <p className={`mt-1 text-[11px] font-semibold ${strength.textClass}`}>{strength.label}</p>
        </div>
      )}

      {hint && <p className="mt-1.5 text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}