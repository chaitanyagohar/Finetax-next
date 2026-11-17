import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------
   The Content Security Policy is set per request in src/proxy.ts
   (src/lib/csp.ts), with a fresh nonce for Next's own scripts.
   --------------------------------------------------------- */

const securityHeaders = [
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
      {
        // API responses are data, never pages: nothing in them may run or load (pages get theirs in src/proxy.ts)
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }],
      },
    ];
  },
};

export default nextConfig;