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
    sellerShareByDomain: {},
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
    rarity: { min: 0.5, max: 3, exponent: 0.5, includeSynthetic: true },
    demand: {
      coef: 0.5,
      min: 0.8,
      max: 2,
      windowDays: 14,
      maxDailyChange: 0.2,
      changeWindowHours: 24,
      bountyWeightPerDollar: 0.02,
      signalWeights: { search: 0.2, view: 0.05, save: 0.5 },
    },
    freshness: {
      halfLifeDays: 90,
      floor: 0.4,
      deprecatedModelFactor: 0.7,
      /**
       * Model ids the marketplace treats as superseded. Checked when pricing,
       * so adding a model here reprices traces already listed.
       */
      deprecatedModels: [
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
        "claude-3-5-sonnet-20240620",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-7-sonnet-20250219",
      ],
    },
    license: { research: 1.0, eval: 1.5, training: 2.0 },
    policy: "trait-v2",
    v2: {
      rarity: {
        alpha: 2,
        weights: { domain: 0.5, failure: 0.3, stack: 0.2 },
        minParentCohort: 5,
        modelSpread: 0.1,
        min: 0.6,
        max: 2.5,
      },
      niche: { exponent: 0.35, priorWeight: 20, min: 0.85, max: 1.6, strategicWeights: {} },
      richness: {
        coef: 0.4,
        turnsScale: 20,
        repeatPenalty: 0.8,
        perTool: 0.04,
        maxToolBonus: 0.16,
        max: 2,
      },
      failure: {
        none: 1.0,
        attempted: 1.35,
        inferred: 1.6,
        verified: 1.9,
        perPreferencePair: 0.08,
        maxPreferenceBonus: 0.32,
      },
      duplicates: { step: 0.5, floor: 0.4 },
      demand: { halfLifeDays: 7, repeatWeight: 0.5 },
      bounty: { anchorShare: 0.6, maxLift: 1.5 },
      band: { base: 0.08, domainUncertainty: 0.12, thinCohort: 0.08, claimed: 0.05, max: 0.35 },
    },
    quoteLockMinutes: 15,
    /** Prices depend on time (freshness, demand window): refresh them at least this often. */
    refreshIntervalMinutes: 60,
  },
  database: {
    path: "data/trace-marketplace.db",
  },
  storage: {
    /** Folder for stored traces (the local BlobStore). */
    blobPath: "data/blobs",
  },
};
