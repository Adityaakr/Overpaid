import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@overpaid/shared'],
  // Let the dev server load its scripts through a Cloudflare quick tunnel.
  allowedDevOrigins: ['*.trycloudflare.com'],
  // A paid x402 audit verifies the payment, runs the model and settles before it answers.
  experimental: { proxyTimeout: 300_000 },
  // The browser talks to the API through this same origin, so one public URL serves phones and wallets.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
