/** Server-side check of a Cloudflare Turnstile token. SERVER ONLY. */
export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("[turnstile] TURNSTILE_SECRET_KEY is not set.");
    return false;
  }
  if (!token || token.length > 2048) return false;

  const form = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") form.set("remoteip", ip);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const out = await res.json();
    return out?.success === true;
  } catch (e) {
    console.error("[turnstile] verification request failed:", e);
    return false;
  }
}
