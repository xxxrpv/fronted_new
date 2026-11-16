import type { NextConfig } from "next";

const platformBackendOrigin =
  process.env.PLATFORM_BACKEND_ORIGIN?.trim().replace(/\/+$/, "");

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  devIndicators: false,
  agentRules: false,
  experimental: {
    proxyTimeout: 1200000,
  },
  async rewrites() {
    if (!platformBackendOrigin) {
      return [];
    }

    return {
      fallback: [
        {
          source: "/api/v1/:path*",
          destination: `${platformBackendOrigin}/api/v1/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
