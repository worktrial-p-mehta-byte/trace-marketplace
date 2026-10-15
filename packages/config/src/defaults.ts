import type { MarketplaceConfig } from "./schema";

/**
 * Default marketplace configuration. Every tunable number lives here.
 * Override with config/marketplace.config.json or environment variables
 * (see loadConfig). Values match the Pricing model section of the
 * architecture doc; they are starting guesses, not market data.
 */
export const DEFAULT_CONFIG: MarketplaceConfig = {
  revenue: {
    sellerShare: 0.7,
  },
  pricing: {
    basePrice: { tier0: 2.0, tier1: 0.25 },
    multiplierCap: 12,
    floor: 0.1,
    ceiling: 50,
    quality: {
      min: 0.5,
      max: 1.2,
      redactionPenaltyThreshold: 0.2,
      redactionPenalty: 0.3,
      truncatedPenalty: 0.2,
      verifiableBonus: 0.1,
    },
    richness: { coef: 0.4, turnsScale: 20, max: 2 },
    failure: {
      none: 1.0,
      failure: 1.4,
      recovery: 1.8,
      perPreferencePair: 0.1,
      maxPreferenceBonus: 0.4,
    },
    rarity: { min: 0.5, max: 3, exponent: 0.5 },
    demand: { coef: 0.5, min: 0.8, max: 2, windowDays: 14, maxDailyChange: 0.2 },
    freshness: { halfLifeDays: 90, floor: 0.4, deprecatedModelFactor: 0.7 },
    license: { research: 1.0, eval: 1.5, training: 2.0 },
    quoteLockMinutes: 15,
  },
  database: {
    path: "data/trace-marketplace.db",
  },
};
