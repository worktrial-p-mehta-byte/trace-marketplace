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
}

export interface PriceQuote {
  priceCents: number;
  factors: PriceFactors;
  /** Short human explanation of the biggest drivers. */
  summary: string;
}

/** Market state the policy needs beyond the trace itself. */
export interface MarketContext {
  /** How many deduplicated traces share this trace's rarity combination. */
  comboCount: number;
  /** Median combo count across the catalog. */
  medianComboCount: number;
  /** Demand signals and matching supply in the demand window. */
  demandSignals: number;
  matchingSupply: number;
  now: Date;
}

/**
 * Pricing is a pluggable policy: price(traits, tier, license, market).
 * The trait-based v1 policy arrives in M3; bounties, auctions and learned
 * pricing are later policies behind the same interface.
 */
export interface PricingPolicy<Traits = unknown> {
  readonly name: string;
  price(input: {
    traits: Traits;
    tier: Tier;
    license: LicenseScope;
    market: MarketContext;
    config: PricingConfig;
  }): PriceQuote;
}
