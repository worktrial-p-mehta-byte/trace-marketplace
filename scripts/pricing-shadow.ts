import { loadServerConfig } from "@tm/config/server";
import { compareInWindTunnel, shadowReport } from "@tm/core";
import { openDb } from "@tm/db";

/**
 * Compare pricing policies on the current database without changing it:
 *
 *   pnpm pricing:shadow
 *
 * Prints v1 and v2 prices by domain (the shadow report), then both policies
 * through the wind tunnel (a modelled buyer population; see
 * packages/core/src/market/windtunnel.ts for what it assumes).
 */
const config = loadServerConfig();
const db = openDb(config.database.path);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const report = shadowReport(db, { config });
if (!report.rows.length) {
  console.log("No active listings. Run `pnpm demo:reset` first.");
  process.exit(0);
}
console.log(`Active policy: ${config.pricing.policy}\n`);
console.table(
  report.byDomain.map((d) => ({
    domain: d.domain,
    listings: d.listings,
    "v1 median": money(d.v1MedianCents),
    "v2 median": money(d.v2MedianCents),
    "v2 / v1": `${d.medianRatio.toFixed(2)}×`,
  })),
);
console.log(
  `List value of the catalog: v1 ${money(report.totals.v1Cents)}, v2 ${money(report.totals.v2Cents)}\n`,
);
const { v1, v2 } = compareInWindTunnel(db, { config });
console.log("Wind tunnel (20 modelled buyers, one pass over the catalog):");
console.table(
  [v1, v2].map((r) => ({
    policy: r.policy,
    revenue: money(r.revenueCents),
    licenses: r.sales,
    "sell-through": `${Math.round(r.sellThrough * 100)}%`,
  })),
);
