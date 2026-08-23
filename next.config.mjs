/** @type {import('next').NextConfig} */

const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "pdfkit",
      "imapflow",
      "mailparser",
    ],
  },
};

export default nextConfig;