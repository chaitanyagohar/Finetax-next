/** @type {import('next').NextConfig} */

const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      '@react-pdf/renderer',
      "imapflow",
      "mailparser",
    ],
  },
};

export default nextConfig;