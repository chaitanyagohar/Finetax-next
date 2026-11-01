/** Signed public links (no login). SERVER ONLY. */
import { createHmac, timingSafeEqual } from "crypto";

/** Public address of the app, used in links sent to clients. */
function siteUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return url.replace(/\/+$/, "");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dedicated signing secret for public links (never the service-role key). */
function secret(): string {
  const s = process.env.PUBLIC_LINK_SECRET;
  if (!s || s.length < 32) throw new Error("PUBLIC_LINK_SECRET is missing or shorter than 32 characters.");
  return s;
}

function signature(id: string): string {
  return createHmac("sha256", secret()).update(`proposal:${id}`).digest("base64url").slice(0, 32);
}

export function proposalToken(id: string): string {
  return `${id}.${signature(id)}`;
}

/** Returns the proposal id if the token is genuine, otherwise null. */
export function verifyProposalToken(token: string): string | null {
  const [id, sig] = String(token || "").split(".");
  if (!id || !sig || !UUID_RE.test(id)) return null;
  const expected = Buffer.from(signature(id));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return id;
}

export function proposalUrl(id: string): string {
  return `${siteUrl()}/engagement/${proposalToken(id)}`;
}