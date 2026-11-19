import type { NextConfig } from "next";

const config = {
  output: "standalone",
  agentRules: false,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
} satisfies NextConfig;
export default config;
