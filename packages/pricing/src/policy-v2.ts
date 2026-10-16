import type { PricingConfig } from "@tm/config";
import { domainName, type TraceTraits } from "@tm/enrich";
import {
  baseFactor,
  clamp,
  demandFactor,
  freshnessFactor,
  isModelDeprecated,
  licenseFactor,
  qualityFactor,
} from "./factors";
import {
  bandWidth,
  bountyAnchor,
  duplicatesFactor,
  failureFactorV2,
  nicheFactor,
  rarityFactorV2,
  richnessFactorV2,
  type FailureEvidence,
} from "./factors-v2";
import { traitPolicyV1 } from "./policy";
import type { FactorKey, MarketContextV2, PriceDriver, PriceFactors, PricingPolicy } from "./types";

const FAILURE_NAMES: Record<string, string> = {
  test_tampering: "agent tampered with a failing test",
  retry_loop: "agent stuck in a retry loop",
  user_correction: "user corrected the agent",
  tool_rejected: "user rejected an action",
  user_interrupt: "user interrupted the agent",
  tool_error: "tool errors",
};

const EVIDENCE: Record<FailureEvidence, string> = {
  none: "no failures",
  attempted: "unresolved",
  inferred: "then recovered (judged from the agent's finish)",
  verified: "then recovered, and the final check passes",
};

function direction(v: number): PriceDriver["direction"] {
  if (v >= 1.05) return "up";
  if (v <= 0.95) return "down";
  return "neutral";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const times = (n: number) => `${Math.round(n)}×`;

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

/** Round a band edge to 5 cents, so the range reads as a range, not a second price. */
const to5 = (cents: number) => Math.max(5, Math.round(cents / 5) * 5);

/**
 * Pricing V2:
 *   P = clamp( anchor( B · min(cap, Q·R·F·X·N·D·U·T) ) · L, floor, ceiling )
 *
 * Rarity is measured domain first (domain → failure → stack, smoothed),
 * the niche factor N weighs the domain's demand against its supply,
 * richness counts information rather than length, failures are tiered by
 * evidence, near-duplicates from one seller are discounted, demand is
 * decayed and deduplicated per buyer, and an open bounty can pull a
 * matching price up towards its offer. Every quote carries a price band.
 *
 * Without V2 market data (`market.v2`), it prices exactly as v1.
 */
export const traitPolicyV2: PricingPolicy<TraceTraits> = {
  name: "trait-v2",
  price(input) {
    const { traits: t, tier, license, market, config: c } = input;
    const ctx = market.v2;
    if (!ctx) return { ...traitPolicyV1.price(input), policy: traitPolicyV1.name };
    const v2 = c.v2;
    const domain = t.domain ?? "unknown";

    const base = baseFactor(tier, c);
    const quality = qualityFactor(t, c);
    const richness = richnessFactorV2(t, v2);
    const fail = failureFactorV2(t, v2);
    const rar = rarityFactorV2(ctx.cohorts, v2);
    const niche = nicheFactor(domain, ctx.niche, v2);
    const demand = demandFactor(market.demandPressure, c, market.baselineDemand);
    const duplicates = duplicatesFactor(ctx.duplicates, v2);
    const freshness = freshnessFactor(t, market.now, c);
    const lic = licenseFactor(license, c);

    const rawMultiplier =
      quality * richness * fail.value * rar.value * niche.value * demand * duplicates * freshness;
    const multiplier = Math.min(c.multiplierCap, rawMultiplier);
    const unanchored = base * multiplier;
    const anchored = bountyAnchor(unanchored, ctx.bountyAnchorCents, v2);
    const bounty = unanchored > 0 ? anchored / unanchored : 1;
    const unclamped = anchored * lic;
    const dollars = clamp(unclamped, c.floor, c.ceiling);

    const factors: PriceFactors = {
      base,
      quality,
      richness,
      failure: fail.value,
      rarity: rar.value,
      niche: niche.value,
      demand,
      duplicates,
      bounty,
      freshness,
      license: lic,
      rawMultiplier,
      multiplier,
      capped: multiplier !== rawMultiplier || dollars !== unclamped,
    };
    const ds = drivers(t, factors, ctx, rar.levels, niche, fail.evidence, market.now, c);
    const priceCents = Math.round(dollars * 100);
    const w = bandWidth(t, ctx, v2);
    return {
      priceCents,
      factors,
      drivers: ds,
      summary: summarise(ds),
      policy: "trait-v2",
      band: {
        lowCents: Math.min(priceCents, to5(priceCents * (1 - w))),
        highCents: Math.max(priceCents, to5(priceCents * (1 + w))),
      },
    };
  },
};

function drivers(
  t: TraceTraits,
  f: PriceFactors,
  ctx: MarketContextV2,
  levels: { domain: number; failure: number; stack?: number; model: number },
  niche: { demandShare: number; supplyShare: number; strategic: number },
  evidence: FailureEvidence,
  now: Date,
  c: PricingConfig,
): PriceDriver[] {
  const ageDays = Math.max(0, Math.round((now.getTime() - Date.parse(t.capturedAt)) / 86_400_000));
  const dn = domainName(t.domain ?? "unknown");
  const stack = [t.language, t.framework].filter(Boolean).join(" / ");
  const k = ctx.cohorts;
  const rarityParts = [
    `${dn}: ${k.domain.count} listed (typical ${times(k.domain.typical)})`,
    `with this failure: ${k.failure.count}`,
    levels.stack !== undefined && stack ? `${stack}: ${k.stack.count}` : undefined,
  ].filter(Boolean);
  const repeats = t.repeatRatio ?? 0;
  const reasons: Record<FactorKey, string> = {
    quality:
      [
        t.testsRanAtEnd ? "outcome checked" : undefined,
        t.redactionDensity > c.quality.redactionPenaltyThreshold
          ? `${pct(t.redactionDensity)} redacted`
          : undefined,
        t.truncated ? "some output truncated" : undefined,
      ]
        .filter(Boolean)
        .join(", ") || "clean, nothing notable",
    richness: [
      `${t.turns} turns, ${t.toolCalls} tool calls`,
      t.distinctTools ? `${t.distinctTools} tool${t.distinctTools === 1 ? "" : "s"}` : undefined,
      repeats >= 0.2 ? `${pct(repeats)} repeated calls count for little` : undefined,
    ]
      .filter(Boolean)
      .join(", "),
    failure: !t.hadFailure
      ? EVIDENCE.none
      : `${FAILURE_NAMES[t.failureCategory ?? ""] ?? "failure"}, ${EVIDENCE[evidence]}${
          t.preferencePairs
            ? `; ${t.preferencePairs} preference pair${t.preferencePairs > 1 ? "s" : ""}`
            : ""
        }`,
    rarity: rarityParts.join("; "),
    niche:
      t.domain === "unknown"
        ? "domain unclear, so no niche adjustment"
        : `${dn} is ${pct(niche.supplyShare)} of supply and ${pct(niche.demandShare)} of buyer demand${
            niche.strategic !== 1 ? `; marketplace weight ${niche.strategic.toFixed(2)}×` : ""
          }`,
    demand:
      f.demand > 1.005
        ? "buyers are asking for this"
        : f.demand < 0.995
          ? "little buyer interest"
          : "normal demand",
    bounty:
      (f.bounty ?? 1) > 1.001
        ? `an open bounty offers $${((ctx.bountyAnchorCents ?? 0) / 100).toFixed(2)} a trace`
        : ctx.bountyAnchorCents
          ? "an open bounty matches; the price is already near its offer"
          : "no open bounty matches",
    duplicates: ctx.duplicates
      ? `the seller lists ${ctx.duplicates} more session${ctx.duplicates > 1 ? "s" : ""} of this exact shape`
      : "no near-duplicates from this seller",
    freshness: `${ageDays} day${ageDays === 1 ? "" : "s"} old${isModelDeprecated(t, c) ? `, ${t.model} is superseded` : ""}`,
  };
  const order: FactorKey[] = [
    "failure",
    "rarity",
    "niche",
    "demand",
    "bounty",
    "richness",
    "quality",
    "duplicates",
    "freshness",
  ];
  return order.map((key) => {
    const value = (f[key as keyof PriceFactors] as number | undefined) ?? 1;
    return { factor: key, value, reason: reasons[key], direction: direction(value) };
  });
}
