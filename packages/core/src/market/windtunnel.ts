import type { MarketplaceConfig } from "@tm/config";
import type { Db } from "@tm/db";
import type { TraceTraits } from "@tm/enrich";
import { failureEvidence, traitPolicyV1, traitPolicyV2, type PricingPolicy } from "@tm/pricing";
import { buildMarket } from "../pricing";

/**
 * The wind tunnel: a fixed population of buyers shopping the catalog, so two
 * pricing policies can be compared on the money they would make before
 * either is switched on. It is a model, not a forecast, and it says what it
 * assumes:
 *
 * - Labs pay for what a trace teaches: failures with evidence of how they
 *   ended, information-rich sessions, recent models.
 * - Labs want diverse domains: a domain's value to buyers falls with its
 *   share of supply (`domainElasticity`), so scarce domains are worth more.
 * - Each buyer's willingness to pay for a trace is that value times
 *   log-normal noise (`spread`); a buyer licenses every trace whose price is
 *   at or under their willingness to pay (data can be licensed many times).
 *
 * Revenue for a trace is price × the expected number of buyers who buy at
 * that price. Deterministic: no randomness, just the log-normal's tail.
 */
export interface WindTunnelOptions {
  buyers: number;
  /** σ of the log-normal willingness-to-pay noise. */
  spread: number;
  /** How strongly buyers value scarce domains: value ∝ supplyShare^−e. */
  domainElasticity: number;
  /** Willingness to pay of a typical trace, in dollars. */
  typicalValue: number;
}

export const WIND_TUNNEL_DEFAULTS: WindTunnelOptions = {
  buyers: 20,
  spread: 0.6,
  domainElasticity: 0.35,
  typicalValue: 4,
};

/** Standard normal CDF (Abramowitz–Stegun 7.1.26), good to ~1e-7. */
function phi(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** What a trace is worth to the modelled buyers, before noise. */
export function buyerValue(
  t: TraceTraits,
  domainShare: number,
  now: Date,
  o: WindTunnelOptions,
): number {
  const evidence = { none: 0.7, attempted: 1.1, inferred: 1.4, verified: 1.9 }[failureEvidence(t)];
  const info = Math.min(
    2,
    1 + 0.35 * Math.log2(1 + (t.turns * (1 - 0.8 * (t.repeatRatio ?? 0))) / 20),
  );
  const ageDays = Math.max(0, (now.getTime() - Date.parse(t.capturedAt)) / 86_400_000);
  const fresh = Math.max(0.4, 0.5 ** (ageDays / 120));
  const scarcity = Math.max(0.01, domainShare) ** -o.domainElasticity / 2.0 ** o.domainElasticity;
  return o.typicalValue * evidence * info * fresh * scarcity * (t.redactionDensity > 0.2 ? 0.7 : 1);
}

export interface WindTunnelResult {
  policy: string;
  revenueCents: number;
  /** Licenses sold (expected). */
  sales: number;
  /** Share of listings that at least a quarter of the buyers would license. */
  sellThrough: number;
  byDomain: Record<string, { revenueCents: number; sales: number }>;
}

export function runWindTunnel(
  db: Db,
  deps: { config: MarketplaceConfig; now?: Date },
  policy: PricingPolicy<TraceTraits>,
  opts: Partial<WindTunnelOptions> = {},
): WindTunnelResult {
  const o = { ...WIND_TUNNEL_DEFAULTS, ...opts };
  const market = buildMarket(db, { ...deps, policy });
  const supply = new Map<string, number>();
  for (const r of market.active) {
    const d = r.traits.domain ?? "unknown";
    supply.set(d, (supply.get(d) ?? 0) + 1);
  }
  const total = Math.max(1, market.active.length);
  let revenue = 0;
  let sales = 0;
  let sold = 0;
  const byDomain: WindTunnelResult["byDomain"] = {};
  for (const row of market.active) {
    // Signals-only listings are worth less to buyers in proportion to their base price.
    const tierScale =
      row.tier === 1
        ? deps.config.pricing.basePrice.tier1 / deps.config.pricing.basePrice.tier0
        : 1;
    const d = row.traits.domain ?? "unknown";
    const value = buyerValue(row.traits, (supply.get(d) ?? 1) / total, market.now, o) * tierScale;
    const price = market.quote(row).priceCents / 100;
    const buyers = o.buyers * (1 - phi(Math.log(price / value) / o.spread));
    revenue += price * buyers;
    sales += buyers;
    if (buyers >= o.buyers / 4) sold++;
    const b = (byDomain[d] ??= { revenueCents: 0, sales: 0 });
    b.revenueCents += Math.round(price * buyers * 100);
    b.sales += buyers;
  }
  return {
    policy: policy.name,
    revenueCents: Math.round(revenue * 100),
    sales: Math.round(sales * 10) / 10,
    sellThrough: Math.round((100 * sold) / total) / 100,
    byDomain,
  };
}

/** Both policies through the same tunnel. */
export function compareInWindTunnel(
  db: Db,
  deps: { config: MarketplaceConfig; now?: Date },
  opts: Partial<WindTunnelOptions> = {},
) {
  return {
    v1: runWindTunnel(db, deps, traitPolicyV1, opts),
    v2: runWindTunnel(db, deps, traitPolicyV2, opts),
  };
}
