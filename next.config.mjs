import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";

/* ---------------------------------------------------------
   Content Security Policy
   Restricts where scripts, styles, images and network
   requests can come from. Supabase (REST + Realtime) is
   allowed explicitly.
   If a feature breaks after enabling this, set
   CSP_REPORT_ONLY = true, reproduce the issue, and send me
   the red "Content-Security-Policy" messages from the
   browser console (F12).
   --------------------------------------------------------- */
const CSP_REPORT_ONLY = false;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseHosts = supabaseUrl
  ? `${supabaseUrl} ${supabaseUrl.replace(/^https:\/\//, "wss://")}`
  : "https://*.supabase.co wss://*.supabase.co";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseHosts}${isDev ? " ws: wss:" : ""}`,
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: CSP_REPORT_ONLY ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Only takes effect when the app is served over HTTPS; ignored on plain HTTP
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Packages that must run as native Node modules on the server (not bundled)
  serverExternalPackages: ["@react-pdf/renderer", "imapflow", "mailparser"],

  // Don't advertise the framework in response headers
  poweredByHeader: false,

  // Pin the project root (fixes the stray package-lock.json warning)
  turbopack: {
    root: __dirname,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;