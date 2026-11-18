/**
 * Content Security Policy for pages (S-15). Scripts run only from this site and only with this
 * request's nonce, so an injected inline script is refused. 'strict-dynamic' lets those scripts
 * load what they need (the Turnstile widget). Styles stay 'unsafe-inline' for React style attributes.
 * If a feature breaks, set CSP_REPORT_ONLY to true, reproduce it, and check the browser console.
 */
export const CSP_REPORT_ONLY = false;

export function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseHosts = supabaseUrl
    ? `${supabaseUrl} ${supabaseUrl.replace(/^http/, "ws")}`
    : "https://*.supabase.co wss://*.supabase.co";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseHosts} https://challenges.cloudflare.com${isDev ? " ws: wss:" : ""}`,
    "frame-src 'self' blob: https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const CSP_HEADER = CSP_REPORT_ONLY ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
