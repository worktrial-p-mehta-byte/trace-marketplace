import { z } from "zod";

const share = z.number().min(0).max(1);
const positive = z.number().positive();

export const PricingConfig = z.object({
  /** Base price in dollars by sharing tier (v0 tiers only). */
  basePrice: z.object({ tier0: positive, tier1: positive }),
  /** Cap on the product of all trait multipliers (Q·R·F·X·D·T). */
  multiplierCap: positive,
  floor: positive,
  ceiling: positive,
  quality: z.object({
    min: positive,
    max: positive,
    redactionPenaltyThreshold: share,
    redactionPenalty: z.number().min(0),
    truncatedPenalty: z.number().min(0),
    verifiableBonus: z.number().min(0),
  }),
  richness: z.object({ coef: z.number().min(0), turnsScale: positive, max: positive }),
  failure: z.object({
    none: positive,
    failure: positive,
    recovery: positive,
    perPreferencePair: z.number().min(0),
    maxPreferenceBonus: z.number().min(0),
  }),
  rarity: z.object({
    min: positive,
    max: positive,
    exponent: positive,
    /** Count synthetic traces toward rarity (true for the demo catalog; false in production). */
    includeSynthetic: z.boolean(),
  }),
  demand: z.object({
    coef: z.number().min(0),
    min: positive,
    max: positive,
    windowDays: positive,
    /** Max relative change of the demand factor versus the baseline snapshot. */
    maxDailyChange: share,
    /** Age of the snapshot used as the baseline for maxDailyChange. */
    changeWindowHours: positive,
    /** Weight of each buyer action as a demand signal. */
    /** Demand weight a bounty adds per dollar of its total budget. */
    bountyWeightPerDollar: z.number().min(0),
    signalWeights: z.object({
      search: z.number().min(0),
      view: z.number().min(0),
      save: z.number().min(0),
    }),
  }),
  freshness: z.object({
    halfLifeDays: positive,
    floor: share,
    deprecatedModelFactor: share,
    deprecatedModels: z.array(z.string().min(1)),
  }),
  license: z.object({ research: positive, eval: positive, training: positive }),
  /** Which pricing policy prices the catalog. "trait-v1" stays available as a fallback. */
  policy: z.enum(["trait-v1", "trait-v2"]),
  /** Pricing V2 (see docs/PRICING.md). */
  v2: z.object({
    rarity: z.object({
      /** Smoothing pseudo-count added to cohort and typical sizes. */
      alpha: z.number().min(0),
      /** Weights of the domain, domain+failure and domain+failure+stack levels (sum to 1). */
      weights: z.object({ domain: share, failure: share, stack: share }),
      /** The stack level only counts once the domain+failure cohort is at least this big. */
      minParentCohort: z.number().int().min(0),
      /** How far the model's scarcity within the domain can move rarity, ± this share. */
      modelSpread: share,
      min: positive,
      max: positive,
    }),
    niche: z.object({
      /** Elasticity of the niche factor to (demand share / supply share). */
      exponent: z.number().min(0),
      /** Prior demand, in signal-weight units, spread like supply (no demand → factor 1). */
      priorWeight: positive,
      min: positive,
      max: positive,
      /** Platform lever: extra weight for domains the marketplace wants more of. Default none. */
      strategicWeights: z.record(z.string(), positive),
    }),
    richness: z.object({
      coef: z.number().min(0),
      turnsScale: positive,
      /** How much exact repeats count against turns: 1 means a repeated call adds nothing. */
      repeatPenalty: share,
      /** Bonus per distinct tool beyond the first, up to maxToolBonus. */
      perTool: z.number().min(0),
      maxToolBonus: z.number().min(0),
      max: positive,
    }),
    failure: z.object({
      none: positive,
      /** A failure the agent did not get past. */
      attempted: positive,
      /** Recovered, judged from the agent finishing with a successful action. */
      inferred: positive,
      /** Recovered and checked: tests (or the domain's check) pass after the failure. */
      verified: positive,
      perPreferencePair: z.number().min(0),
      maxPreferenceBonus: z.number().min(0),
    }),
    duplicates: z.object({
      /** Each further listing of the same session shape by the same seller discounts by this. */
      step: z.number().min(0),
      floor: share,
    }),
    demand: z.object({
      /** Signals lose half their weight after this many days (within the window). */
      halfLifeDays: positive,
      /** Repeats of the same search by one buyer add log2(n) times this, not n. */
      repeatWeight: z.number().min(0),
    }),
    bounty: z.object({
      /** Share of an open bounty's per-trace offer a matching listing is pulled up to. */
      anchorShare: share,
      /** The pull is at most this multiple of the unanchored price. */
      maxLift: positive,
    }),
    band: z.object({
      /** Half-width of the price band as a share of price: base, plus extra for uncertainty. */
      base: share,
      domainUncertainty: share,
      thinCohort: share,
      claimed: share,
      max: share,
    }),
  }),
  quoteLockMinutes: positive,
  refreshIntervalMinutes: positive,
});

export const MarketplaceConfig = z
  .object({
    revenue: z.object({
      /** Fraction of each sale paid to the seller. The platform keeps the rest. */
      sellerShare: share,
      /** Platform lever: a different seller share for some domains. Default none. */
      sellerShareByDomain: z.record(z.string(), share),
    }),
    pricing: PricingConfig,
    database: z.object({ path: z.string().min(1) }),
    storage: z.object({ blobPath: z.string().min(1) }),
  })
  .superRefine((c, ctx) => {
    if (c.pricing.floor >= c.pricing.ceiling) {
      ctx.addIssue({ code: "custom", message: "pricing.floor must be below pricing.ceiling" });
    }
    if (c.pricing.quality.min > c.pricing.quality.max) {
      ctx.addIssue({ code: "custom", message: "pricing.quality.min must not exceed max" });
    }
    const v2 = c.pricing.v2;
    const w = v2.rarity.weights;
    if (Math.abs(w.domain + w.failure + w.stack - 1) > 1e-6) {
      ctx.addIssue({ code: "custom", message: "pricing.v2.rarity.weights must sum to 1" });
    }
    for (const [k, r] of [
      ["rarity", v2.rarity],
      ["niche", v2.niche],
    ] as const) {
      if (r.min > r.max) {
        ctx.addIssue({ code: "custom", message: `pricing.v2.${k}.min must not exceed max` });
      }
    }
  });

export type PricingConfig = z.infer<typeof PricingConfig>;
export type MarketplaceConfig = z.infer<typeof MarketplaceConfig>;

/** The seller's share of a sale in a domain (the per-domain override, else the default). */
export function sellerShareFor(config: MarketplaceConfig, domain?: string): number {
  const override = domain ? config.revenue.sellerShareByDomain[domain] : undefined;
  return override ?? config.revenue.sellerShare;
}

/** Platform fee is always derived, never configured separately, so the split can't drift. */
export function platformShare(config: MarketplaceConfig): number {
  return 1 - config.revenue.sellerShare;
}
