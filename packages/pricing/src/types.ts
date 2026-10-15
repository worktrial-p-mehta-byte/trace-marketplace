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
  /** Product Q·R·F·X·D·T before the cap. */
  rawMultiplier: number;
  /** After applying the multiplier cap. */
  multiplier: number;
  /** True when the multiplier cap, floor or ceiling changed the price. */
  capped: boolean;
}

export type FactorKey = "quality" | "richness" | "failure" | "rarity" | "demand" | "freshness";

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
