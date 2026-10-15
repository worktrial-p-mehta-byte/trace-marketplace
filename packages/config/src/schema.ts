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
  }),
  freshness: z.object({ halfLifeDays: positive, floor: share, deprecatedModelFactor: share }),
  license: z.object({ research: positive, eval: positive, training: positive }),
  quoteLockMinutes: positive,
});

export const MarketplaceConfig = z
  .object({
    revenue: z.object({
      /** Fraction of each sale paid to the seller. The platform keeps the rest. */
      sellerShare: share,
    }),
    pricing: PricingConfig,
    database: z.object({ path: z.string().min(1) }),
  })
  .superRefine((c, ctx) => {
    if (c.pricing.floor >= c.pricing.ceiling) {
      ctx.addIssue({ code: "custom", message: "pricing.floor must be below pricing.ceiling" });
    }
    if (c.pricing.quality.min > c.pricing.quality.max) {
      ctx.addIssue({ code: "custom", message: "pricing.quality.min must not exceed max" });
    }
  });

export type PricingConfig = z.infer<typeof PricingConfig>;
export type MarketplaceConfig = z.infer<typeof MarketplaceConfig>;

/** Platform fee is always derived, never configured separately, so the split can't drift. */
export function platformShare(config: MarketplaceConfig): number {
  return 1 - config.revenue.sellerShare;
}
