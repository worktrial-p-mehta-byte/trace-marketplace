import type { PricingConfig } from "@tm/config";
import type { TraceTraits } from "@tm/enrich";
import { clamp } from "./factors";
import type { Cohort, MarketContextV2 } from "./types";

type V2 = PricingConfig["v2"];

/** One level's scarcity: √((typical + α) / (count + α)). Above 1 when rarer than typical. */
export function cohortScore(c: Cohort, alpha: number): number {
  return Math.sqrt((c.typical + alpha) / (Math.max(1, c.count) + alpha));
}

/**
 * X (V2): scarcity measured domain first. A geometric blend of how rare the
 * trace is at the domain, domain+failure and domain+failure+stack levels,
 * smoothed so a cohort of one isn't infinitely rare, then nudged ± a little
 * by how common its model is within the domain. The stack level only counts
 * once the domain+failure cohort is big enough to compare stacks within it.
 */
export function rarityFactorV2(
  cohorts: MarketContextV2["cohorts"],
  v2: V2,
): { value: number; levels: { domain: number; failure: number; stack?: number; model: number } } {
  const r = v2.rarity;
  const a = r.alpha;
  const domain = cohortScore(cohorts.domain, a);
  const failure = cohortScore(cohorts.failure, a);
  const useStack = cohorts.failure.count >= r.minParentCohort;
  const stack = useStack ? cohortScore(cohorts.stack, a) : undefined;
  const w = r.weights;
  // Without the stack level its weight goes to the two levels above, pro rata.
  const scale = useStack ? 1 : 1 / (w.domain + w.failure);
  const logX =
    w.domain * scale * Math.log(domain) +
    w.failure * scale * Math.log(failure) +
    (stack !== undefined ? w.stack * Math.log(stack) : 0);
  const model = clamp(cohortScore(cohorts.model, a), 1 - r.modelSpread, 1 + r.modelSpread);
  return {
    value: clamp(Math.exp(logX) * model, r.min, r.max),
    levels: { domain, failure, stack, model },
  };
}

/**
 * N: the niche line. How much buyers want this domain relative to how much
 * of it is for sale: (demand share / supply share)^β, with a prior that
 * spreads demand like supply, so a domain nobody has asked about yet sits at
 * 1. Multiplied by the platform's strategic weight for the domain, if any.
 */
export function nicheFactor(
  domain: string,
  n: MarketContextV2["niche"],
  v2: V2,
): { value: number; demandShare: number; supplyShare: number; strategic: number } {
  const c = v2.niche;
  const strategic = c.strategicWeights[domain] ?? 1;
  if (domain === "unknown" || n.totalSupply <= 0) {
    return { value: clamp(strategic, c.min, c.max), demandShare: 0, supplyShare: 0, strategic };
  }
  const supplyShare = Math.max(1, n.domainSupply) / Math.max(1, n.totalSupply);
  const demandShare =
    (n.domainDemand + c.priorWeight * supplyShare) / (n.totalDemand + c.priorWeight);
  const value = clamp(strategic * (demandShare / supplyShare) ** c.exponent, c.min, c.max);
  return { value, demandShare, supplyShare, strategic };
}

/**
 * R (V2): information, not length. Exact repeats of an earlier call count
 * for little (re-running the same failing command ten times is one event's
 * worth of information); each extra tool the agent used adds a little.
 */
export function richnessFactorV2(
  t: Pick<TraceTraits, "turns"> & Partial<Pick<TraceTraits, "repeatRatio" | "distinctTools">>,
  v2: V2,
): number {
  const r = v2.richness;
  const repeat = clamp(t.repeatRatio ?? 0, 0, 1);
  const effective = t.turns * (1 - r.repeatPenalty * repeat);
  const tools = Math.min(r.maxToolBonus, r.perTool * Math.max(0, (t.distinctTools ?? 1) - 1));
  return Math.min(r.max, (1 + r.coef * Math.log2(1 + effective / r.turnsScale)) * (1 + tools));
}

export type FailureEvidence = "none" | "attempted" | "inferred" | "verified";

/** How well the session shows what went wrong and how it ended. */
export function failureEvidence(
  t: Pick<TraceTraits, "hadFailure" | "recovered" | "testsPassedAtEnd">,
): FailureEvidence {
  if (!t.hadFailure) return "none";
  if (!t.recovered) return "attempted";
  return t.testsPassedAtEnd ? "verified" : "inferred";
}

/**
 * F (V2): failures tiered by evidence. A recovery the session proves (the
 * check passes after the failure) is worth more than one inferred from the
 * agent's last word, which is worth more than a failure left unresolved.
 * Preference pairs (a correction the agent then acts on) add a modest bonus.
 */
export function failureFactorV2(
  t: Pick<TraceTraits, "hadFailure" | "recovered" | "testsPassedAtEnd" | "preferencePairs">,
  v2: V2,
): { value: number; evidence: FailureEvidence } {
  const f = v2.failure;
  const evidence = failureEvidence(t);
  if (evidence === "none") return { value: f.none, evidence };
  const pairs = Math.min(
    f.maxPreferenceBonus,
    Math.max(0, t.preferencePairs) * f.perPreferencePair,
  );
  return { value: f[evidence] + pairs, evidence };
}

/** U: each further copy of the same session shape from one seller is worth less. */
export function duplicatesFactor(others: number, v2: V2): number {
  const d = v2.duplicates;
  return Math.max(d.floor, 1 / (1 + d.step * Math.max(0, others)));
}

/**
 * Bounty anchoring: a buyer has said what this kind of trace is worth to
 * them. A matching listing priced below a share of that offer is pulled up
 * towards it, by at most `maxLift`, never past the offer itself.
 */
export function bountyAnchor(dollars: number, anchorCents: number | undefined, v2: V2): number {
  if (!anchorCents || anchorCents <= 0 || dollars <= 0) return dollars;
  const target = (v2.bounty.anchorShare * anchorCents) / 100;
  if (dollars >= target) return dollars;
  return Math.min(target, dollars * v2.bounty.maxLift);
}

/** Half-width of the price band, as a share of the price. */
export function bandWidth(
  t: Partial<Pick<TraceTraits, "domain" | "domainConfidence">>,
  ctx: MarketContextV2,
  v2: V2,
): number {
  const b = v2.band;
  const domainUnsure = t.domain === "unknown" ? 1 : 1 - clamp(t.domainConfidence ?? 0, 0, 1);
  const thin = ctx.cohorts.failure.count < 3 ? 1 : 0;
  return Math.min(
    b.max,
    b.base +
      b.domainUncertainty * domainUnsure +
      b.thinCohort * thin +
      (ctx.claimed ? b.claimed : 0),
  );
}
