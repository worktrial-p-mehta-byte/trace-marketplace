import type { PricingConfig } from "@tm/config";
import type { TraceTraits } from "@tm/enrich";
import {
  baseFactor,
  clamp,
  demandFactor,
  failureFactor,
  freshnessFactor,
  isModelDeprecated,
  licenseFactor,
  qualityFactor,
  rarityFactor,
  richnessFactor,
} from "./factors";
import type { FactorKey, PriceDriver, PriceFactors, PricingPolicy } from "./types";

const FAILURE_NAMES: Record<string, string> = {
  test_tampering: "agent tampered with a failing test",
  retry_loop: "agent stuck in a retry loop",
  user_correction: "user corrected the agent",
  tool_rejected: "user rejected an action",
  user_interrupt: "user interrupted the agent",
  tool_error: "tool errors",
};

function direction(v: number): PriceDriver["direction"] {
  if (v >= 1.05) return "up";
  if (v <= 0.95) return "down";
  return "neutral";
}

function drivers(
  t: TraceTraits,
  f: PriceFactors,
  comboCount: number,
  medianComboCount: number,
  now: Date,
  c: PricingConfig,
): PriceDriver[] {
  const ageDays = Math.max(0, Math.round((now.getTime() - Date.parse(t.capturedAt)) / 86_400_000));
  const combo = [t.language, t.framework].filter(Boolean).join(" / ") || "unknown stack";
  const reasons: Record<FactorKey, string> = {
    quality:
      [
        t.testsRanAtEnd ? "outcome checked by tests" : undefined,
        t.redactionDensity > c.quality.redactionPenaltyThreshold
          ? `${Math.round(t.redactionDensity * 100)}% redacted`
          : undefined,
        t.truncated ? "some output truncated" : undefined,
      ]
        .filter(Boolean)
        .join(", ") || "clean, nothing notable",
    richness: `${t.turns} turns, ${t.toolCalls} tool calls`,
    failure: !t.hadFailure
      ? "no failures"
      : `${FAILURE_NAMES[t.failureCategory ?? ""] ?? "failure"}${t.recovered ? ", then recovered" : ", unresolved"}${
          t.preferencePairs
            ? `; ${t.preferencePairs} preference pair${t.preferencePairs > 1 ? "s" : ""}`
            : ""
        }`,
    rarity:
      medianComboCount <= 0
        ? `${combo} + ${t.failureCategory ?? "no failure"}: first of its kind, no comparison yet`
        : `${combo} + ${t.failureCategory ?? "no failure"}: seen ${comboCount}× (typical ${medianComboCount}×)`,
    demand:
      f.demand > 1.005
        ? "buyers are searching for this"
        : f.demand < 0.995
          ? "little buyer interest"
          : "normal demand",
    freshness: `${ageDays} day${ageDays === 1 ? "" : "s"} old${isModelDeprecated(t, c) ? `, ${t.model} is superseded` : ""}`,
  };
  return (["failure", "rarity", "demand", "richness", "quality", "freshness"] as FactorKey[]).map(
    (k) => ({ factor: k, value: f[k], reason: reasons[k], direction: direction(f[k]) }),
  );
}

function summarise(ds: PriceDriver[]): string {
  const up = ds
    .filter((d) => d.direction === "up")
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map((d) => `${d.factor} ${d.value.toFixed(1)}×`);
  const down = ds
    .filter((d) => d.direction === "down")
    .sort((a, b) => a.value - b.value)
    .slice(0, 1)
    .map((d) => `${d.factor} ${d.value.toFixed(2)}×`);
  if (!up.length && !down.length) return "Priced at the base rate.";
  return [
    up.length ? `Raised by ${up.join(" and ")}` : "",
    down.length ? `lowered by ${down[0]}` : "",
  ]
    .filter(Boolean)
    .join("; ")
    .replace(/^./, (ch) => ch.toUpperCase())
    .concat(".");
}

/**
 * Trait-based pricing, v1:
 *   P = clamp( B · min(cap, Q·R·F·X·D·T) · L, floor, ceiling )
 * Every number comes from config; the output carries its own explanation.
 */
export const traitPolicyV1: PricingPolicy<TraceTraits> = {
  name: "trait-v1",
  price({ traits, tier, license, market, config: c }) {
    const base = baseFactor(tier, c);
    const quality = qualityFactor(traits, c);
    const richness = richnessFactor(traits, c);
    const failure = failureFactor(traits, c);
    const rarity = rarityFactor(market.comboCount, market.medianComboCount, c);
    const demand = demandFactor(market.demandPressure, c, market.baselineDemand);
    const freshness = freshnessFactor(traits, market.now, c);
    const lic = licenseFactor(license, c);

    const rawMultiplier = quality * richness * failure * rarity * demand * freshness;
    const multiplier = Math.min(c.multiplierCap, rawMultiplier);
    const unclamped = base * multiplier * lic;
    const dollars = clamp(unclamped, c.floor, c.ceiling);
    const factors: PriceFactors = {
      base,
      quality,
      richness,
      failure,
      rarity,
      demand,
      freshness,
      license: lic,
      rawMultiplier,
      multiplier,
      capped: multiplier !== rawMultiplier || dollars !== unclamped,
    };
    const ds = drivers(traits, factors, market.comboCount, market.medianComboCount, market.now, c);
    return {
      priceCents: Math.round(dollars * 100),
      factors,
      drivers: ds,
      summary: summarise(ds),
    };
  },
};
