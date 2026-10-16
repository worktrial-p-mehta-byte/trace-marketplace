import type { PricingConfig } from "@tm/config";
import type { TraceTraits } from "@tm/enrich";
import type { LicenseScope, Tier } from "@tm/schema";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const DAY_MS = 86_400_000;

/** B: base price in dollars by sharing tier. Only v0 tiers have a price. */
export function baseFactor(tier: Tier, c: PricingConfig): number {
  if (tier === 0) return c.basePrice.tier0;
  if (tier === 1) return c.basePrice.tier1;
  throw new Error(`Tier ${tier} is not priced in v0`);
}

/** Q: penalise heavy redaction and truncation; reward outcomes that can be checked. */
export function qualityFactor(
  t: Pick<TraceTraits, "redactionDensity" | "truncated" | "testsRanAtEnd">,
  c: PricingConfig,
): number {
  const q = c.quality;
  let v = 1;
  if (t.redactionDensity > q.redactionPenaltyThreshold) v -= q.redactionPenalty;
  if (t.truncated) v -= q.truncatedPenalty;
  if (t.testsRanAtEnd) v += q.verifiableBonus;
  return clamp(v, q.min, q.max);
}

/** R: longer sessions carry more signal, with diminishing returns. */
export function richnessFactor(t: Pick<TraceTraits, "turns">, c: PricingConfig): number {
  const r = c.richness;
  return Math.min(r.max, 1 + r.coef * Math.log2(1 + t.turns / r.turnsScale));
}

/** F: failures are what buyers want; failures the agent recovered from most of all. */
export function failureFactor(
  t: Pick<TraceTraits, "hadFailure" | "recovered" | "preferencePairs">,
  c: PricingConfig,
): number {
  const f = c.failure;
  if (!t.hadFailure) return f.none;
  const base = t.recovered ? f.recovery : f.failure;
  return base + Math.min(f.maxPreferenceBonus, t.preferencePairs * f.perPreferencePair);
}

/** X: scarcer combinations of language, framework, failure and model cost more. */
export function rarityFactor(
  comboCount: number,
  medianComboCount: number,
  c: PricingConfig,
): number {
  const r = c.rarity;
  if (medianComboCount <= 0) return 1;
  const ratio = medianComboCount / Math.max(1, comboCount);
  return clamp(ratio ** r.exponent, r.min, r.max);
}

/** D: buyer searches, saves and bounties raise prices, limited per day. */
export function demandFactor(pressure: number, c: PricingConfig, baseline?: number): number {
  const d = c.demand;
  let v = clamp(1 + d.coef * pressure, d.min, d.max);
  if (baseline !== undefined) {
    v = clamp(v, baseline * (1 - d.maxDailyChange), baseline * (1 + d.maxDailyChange));
  }
  return v;
}

/**
 * Is the trace's model superseded? Decided at pricing time from
 * `freshness.deprecatedModels`, so deprecating a model reprices traces that
 * are already listed. A trait set when the trace was enriched also counts.
 */
export function isModelDeprecated(
  t: Pick<TraceTraits, "modelDeprecated"> & { model?: string },
  c: PricingConfig,
): boolean {
  return (
    t.modelDeprecated || (t.model !== undefined && c.freshness.deprecatedModels.includes(t.model))
  );
}

/** T: traces lose value as models move on; deprecated models lose more. */
export function freshnessFactor(
  t: Pick<TraceTraits, "capturedAt" | "modelDeprecated"> & { model?: string },
  now: Date,
  c: PricingConfig,
): number {
  const f = c.freshness;
  const ageDays = Math.max(0, (now.getTime() - Date.parse(t.capturedAt)) / DAY_MS);
  const v = Math.max(f.floor, 0.5 ** (ageDays / f.halfLifeDays));
  return isModelDeprecated(t, c) ? v * f.deprecatedModelFactor : v;
}

/** L: the same data is worth more to train on than to evaluate or study. */
export function licenseFactor(license: LicenseScope, c: PricingConfig): number {
  return c.license[license];
}
