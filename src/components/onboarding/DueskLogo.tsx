/** Duesk logo: a ledger sheet shaped like a D, sealed with the violet stamp dot. */
export default function DueskLogo({ size = 28, wordmark = true, tone = "ink" }: { size?: number; wordmark?: boolean; tone?: "ink" | "light" }) {
  const ink = tone === "ink" ? "#0f172a" : "#ffffff";
  const paper = tone === "ink" ? "#ffffff" : "#0f172a";
  return (
    <span className="inline-flex items-center gap-2" aria-label="Duesk">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill={ink} />
        <path d="M9 7h8a9 9 0 0 1 0 18H9z" fill={paper} />
        <path d="M12 13h6M12 16.5h7M12 20h5" stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="24.5" cy="24.5" r="3.4" fill="#5b3fa0" stroke={ink} strokeWidth="1.2" />
      </svg>
      {wordmark && (
        <span className="font-semibold tracking-tight" style={{ color: ink, fontSize: Math.round(size * 0.64) }}>
          Duesk
        </span>
      )}
    </span>
  );
}