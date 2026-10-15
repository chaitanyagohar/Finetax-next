/**
 * Lightweight in-memory rate limiter (per server process).
 * Suitable for a single-server office deployment. Resets on restart.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Occasional cleanup so the map never grows unbounded
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) {
      if (now > b.resetAt) buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count++;
  return true;
}