/* Decorative shapes. All are aria-hidden and ignore the pointer, so they never get in the way. */

/** Sign-in panel artwork: orbit rings, a dot grid and three floating "work" cards. */
export function AuthArt() {
  return (
    <svg viewBox="0 0 600 600" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" preserveAspectRatio="xMaxYMin slice">
      <defs>
        <radialGradient id="auth-glow" cx="78%" cy="18%" r="55%">
          <stop offset="0%" stopColor="#f2613f" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f2613f" stopOpacity="0" />
        </radialGradient>
        <pattern id="auth-dots" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.2" fill="#ffffff" opacity="0.12" />
        </pattern>
      </defs>
      <rect width="600" height="600" fill="url(#auth-glow)" />
      <rect x="300" y="0" width="300" height="300" fill="url(#auth-dots)" />

      <g fill="none" stroke="#f2613f" className="decor-spin" style={{ transformOrigin: "470px 130px" }}>
        <circle cx="470" cy="130" r="70" strokeOpacity="0.55" strokeWidth="1.5" />
        <circle cx="470" cy="130" r="120" strokeOpacity="0.3" strokeDasharray="4 10" />
        <circle cx="470" cy="130" r="175" strokeOpacity="0.16" />
        <circle cx="590" cy="130" r="6" fill="#f2613f" stroke="none" />
      </g>
      <circle cx="80" cy="560" r="160" fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="40" />

      {/* Floating cards */}
      <g className="decor-float" style={{ animationDelay: "0s" }}>
        <rect x="330" y="196" width="200" height="74" rx="14" fill="#ffffff" fillOpacity="0.07" stroke="#ffffff" strokeOpacity="0.14" />
        <circle cx="356" cy="233" r="9" fill="#f2613f" />
        <path d="M352 233l3 3 6-6" stroke="#0f172a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="376" y="220" width="110" height="8" rx="4" fill="#ffffff" fillOpacity="0.55" />
        <rect x="376" y="238" width="70" height="6" rx="3" fill="#ffffff" fillOpacity="0.25" />
      </g>
      <g className="decor-float" style={{ animationDelay: "-2s" }}>
        <rect x="400" y="290" width="170" height="92" rx="14" fill="#ffffff" fillOpacity="0.07" stroke="#ffffff" strokeOpacity="0.14" />
        <rect x="420" y="310" width="60" height="6" rx="3" fill="#ffffff" fillOpacity="0.3" />
        <text x="420" y="348" fill="#ffffff" fillOpacity="0.85" fontSize="22" fontWeight="600" fontFamily="inherit">
          ₹ 47,200
        </text>
        <rect x="420" y="360" width="44" height="12" rx="6" fill="#10b981" fillOpacity="0.8" />
      </g>
      <g className="decor-float" style={{ animationDelay: "-4s" }}>
        <rect x="290" y="110" width="120" height="56" rx="12" fill="#f2613f" fillOpacity="0.9" />
        <rect x="306" y="126" width="56" height="7" rx="3.5" fill="#ffffff" fillOpacity="0.9" />
        <rect x="306" y="142" width="80" height="6" rx="3" fill="#ffffff" fillOpacity="0.55" />
      </g>
    </svg>
  );
}

/** Dashboard welcome card: a soft coral glow, part rings and a few dots in the corner. */
export function HeroDecor() {
  return (
    <svg viewBox="0 0 320 160" className="pointer-events-none absolute right-0 top-0 h-full w-[320px] max-w-[60%]" aria-hidden="true" preserveAspectRatio="xMaxYMin slice">
      <defs>
        <radialGradient id="hero-glow" cx="85%" cy="10%" r="70%">
          <stop offset="0%" stopColor="#f2613f" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#f2613f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="320" height="160" fill="url(#hero-glow)" />
      <g fill="none" stroke="#f2613f">
        <circle cx="300" cy="10" r="46" strokeOpacity="0.35" />
        <circle cx="300" cy="10" r="78" strokeOpacity="0.18" strokeDasharray="3 7" />
        <circle cx="300" cy="10" r="112" strokeOpacity="0.1" />
      </g>
      <g fill="#0f172a" fillOpacity="0.12">
        {Array.from({ length: 4 }).map((_, row) =>
          Array.from({ length: 6 }).map((_, col) => <circle key={`${row}-${col}`} cx={150 + col * 14} cy={100 + row * 14} r="1.4" />)
        )}
      </g>
      <circle cx="254" cy="56" r="4" fill="#f2613f" className="decor-float" />
    </svg>
  );
}

/** Small illustration for empty lists: a stack of cards with a coral marker. */
export function EmptyArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 84" className={`h-16 w-24 ${className}`} aria-hidden="true">
      <rect x="22" y="14" width="76" height="52" rx="8" fill="var(--color-surface-alt)" stroke="var(--color-border)" />
      <rect x="14" y="22" width="76" height="52" rx="8" fill="var(--color-surface)" stroke="var(--color-border)" />
      <rect x="24" y="34" width="40" height="5" rx="2.5" fill="var(--color-border)" />
      <rect x="24" y="45" width="28" height="4" rx="2" fill="var(--color-border)" />
      <rect x="24" y="55" width="50" height="4" rx="2" fill="var(--color-border)" />
      <circle cx="92" cy="20" r="10" fill="var(--color-accent)" />
      <path d="M88 20h8M92 16v8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
