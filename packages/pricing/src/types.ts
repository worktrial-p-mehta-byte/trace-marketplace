import type { PricingConfig } from "@tm/config";
import type { LicenseScope, Tier } from "@tm/schema";

/** Factor values behind a price, shown to sellers and buyers as "why this price". */
export interface PriceFactors {
  base: number; // B, dollars
  quality: number; // Q
  richness: number; // R
  failure: number; // F
  rarity: number; // X
  demand: number; // D
  freshness: number; // T
  license: number; // L
  /** V2: N, the domain's demand against its supply, times any strategic weight. */
  niche?: number;
  /** V2: U, the discount for a seller listing the same session shape again. */
  duplicates?: number;
  /** V2: how far an open bounty pulled the price up (1 when none). */
  bounty?: number;
  /** Product Q·R·F·X·D·T (and N·U in V2) before the cap. */
  rawMultiplier: number;
  /** After applying the multiplier cap. */
  multiplier: number;
  /** True when the multiplier cap, floor or ceiling changed the price. */
  capped: boolean;
}

export type FactorKey =
  | "quality"
  | "richness"
  | "failure"
  | "rarity"
  | "niche"
  | "demand"
  | "bounty"
  | "duplicates"
  | "freshness";

/** One line of the price explanation. */
export interface PriceDriver {
  factor: FactorKey;
  value: number;
  /** Plain-language reason, e.g. "rare combination: seen 6 times". */
  reason: string;
  direction: "up" | "down" | "neutral";
}

export interface PriceQuote {
  priceCents: number;
  factors: PriceFactors;
  drivers: PriceDriver[];
  /** One sentence naming the biggest drivers. */
  summary: string;
  /** The policy that produced the quote. */
  policy?: string;
  /**
   * V2: the range the price is likely to settle in, wider when the policy is
   * less sure (unclear domain, thin cohort, seller-reported traits).
   */
  band?: { lowCents: number; highCents: number };
}

/** Supply at one cohort level: listings like this one, and the typical cohort size there. */
export interface Cohort {
  /** Deduplicated listings in this trace's cohort, counting this one. */
  count: number;
  /** Trace-weighted typical cohort size at this level: Σc² / Σc. */
  typical: number;
}

/** Market state Pricing V2 reads on top of MarketContext. */
export interface MarketContextV2 {
  cohorts: {
    /** Same domain. */
    domain: Cohort;
    /** Same domain and failure category. */
    failure: Cohort;
    /** Same domain, failure, language and framework. */
    stack: Cohort;
    /** Same domain and model. */
    model: Cohort;
  };
  niche: {
    /** Decayed, deduplicated demand weight on this domain, and on all domains. */
    domainDemand: number;
    totalDemand: number;
    /** Listings in this domain, and in all. */
    domainSupply: number;
    totalSupply: number;
  };
  /** Other active listings by the same seller with the same session shape. */
  duplicates: number;
  /** Highest per-trace offer of an open bounty this trace matches, in cents. */
  bountyAnchorCents?: number;
  /** The traits were reported by the seller's browser (signals only), not verified. */
  claimed: boolean;
}

/** Market state the policy needs beyond the trace itself. */
export interface MarketContext {
  /** How many deduplicated traces share this trace's rarity combination (including this one). */
  comboCount: number;
  /** Median combo count across the catalog. */
  medianComboCount: number;
  /** Demand pressure: Σ (signal weight / listings matching that signal) in the window. */
  demandPressure: number;
  /** Demand factor from the baseline snapshot, if one exists (limits daily swings). */
  baselineDemand?: number;
  now: Date;
  /** Present when the market was built for Pricing V2. */
  v2?: MarketContextV2;
}

/**
 * Pricing is a pluggable policy. The trait-based v1 policy is the default;
 * bounties, auctions and learned pricing are later policies behind the same
 * interface.
 */
export interface PricingPolicy<Traits> {
  readonly name: string;
  price(input: {
    traits: Traits;
    tier: Tier;
    license: LicenseScope;
    market: MarketContext;
    config: PricingConfig;
  }): PriceQuote;
}
