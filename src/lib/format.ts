/** Local (IST) date as YYYY-MM-DD. Avoids the UTC off-by-one before 5:30 AM. */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Strict DD/MM/YYYY formatting from a YYYY-MM-DD (or ISO timestamp) string. */
export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export function formatINR(n: number): string {
  return "₹" + Math.round(n || 0).toLocaleString("en-IN");
}

export function compactINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return formatINR(n);
}

export function getInitials(name?: string | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}