/** Local (IST) date as YYYY-MM-DD. Avoids the UTC off-by-one before 5:30 AM. */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date in India as YYYY-MM-DD. Use on the server, which runs on UTC. */
export function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

/** Strict DD/MM/YYYY formatting from a YYYY-MM-DD (or ISO timestamp) string. */
export function formatDate(value?: string | null, empty = "—"): string {
  if (!value) return empty;
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

/** "Rs. 1,234.50" for PDFs and emails, where the ₹ sign may not render. */
export function rupees(n: unknown): string {
  return `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "₹1,234.50": rupees with paise, for screens. */
export function formatINRExact(n: unknown): string {
  return `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatINR(n: number): string {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}

export function compactINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return formatINR(n);
}

/** 1st, 2nd, 3rd, 4th, 11th, 21st … */
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function getInitials(name?: string | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}