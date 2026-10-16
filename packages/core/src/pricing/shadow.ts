import type { MarketplaceConfig } from "@tm/config";
import type { Db } from "@tm/db";
import { traitPolicyV1, traitPolicyV2, median } from "@tm/pricing";
import { buildMarket } from "./index";

export interface ShadowRow {
  listingId: string;
  domain: string;
  v1Cents: number;
  v2Cents: number;
}

export interface ShadowReport {
  rows: ShadowRow[];
  byDomain: {
    domain: string;
    listings: number;
    v1MedianCents: number;
    v2MedianCents: number;
    /** Median of v2/v1 per listing. */
    medianRatio: number;
  }[];
  totals: { v1Cents: number; v2Cents: number };
}

/**
 * Price the live catalog under both policies without writing anything, so
 * a switch of `pricing.policy` can be judged before it is made (and v1 kept
 * as a fallback). `pnpm pricing:shadow` prints this.
 */
export function shadowReport(
  db: Db,
  deps: { config: MarketplaceConfig; now?: Date },
): ShadowReport {
  const v1 = buildMarket(db, { ...deps, policy: traitPolicyV1 });
  const v2 = buildMarket(db, { ...deps, policy: traitPolicyV2 });
  const v2Rows = new Map(v2.active.map((r) => [r.listingId, r]));
  const rows = v1.active.map((row) => ({
    listingId: row.listingId,
    domain: row.traits.domain ?? "unknown",
    v1Cents: v1.quote(row).priceCents,
    v2Cents: v2.quote(v2Rows.get(row.listingId)!).priceCents,
  }));
  const domains = [...new Set(rows.map((r) => r.domain))];
  const byDomain = domains
    .map((domain) => {
      const rs = rows.filter((r) => r.domain === domain);
      return {
        domain,
        listings: rs.length,
        v1MedianCents: Math.round(median(rs.map((r) => r.v1Cents))),
        v2MedianCents: Math.round(median(rs.map((r) => r.v2Cents))),
        medianRatio: Math.round(100 * median(rs.map((r) => r.v2Cents / r.v1Cents))) / 100,
      };
    })
    .sort((a, b) => b.listings - a.listings);
  return {
    rows,
    byDomain,
    totals: {
      v1Cents: rows.reduce((s, r) => s + r.v1Cents, 0),
      v2Cents: rows.reduce((s, r) => s + r.v2Cents, 0),
    },
  };
}
