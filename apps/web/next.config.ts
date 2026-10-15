import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    "@tm/schema",
    "@tm/config",
    "@tm/core",
    "@tm/db",
    "@tm/adapters",
    "@tm/scrub",
    "@tm/enrich",
    "@tm/pricing",
  ],
  // Native module: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["better-sqlite3"],
  // Linting runs from the repo root (pnpm lint), not during next build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
