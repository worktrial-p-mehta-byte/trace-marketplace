import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "@tm/config";
import type { TraceTraits } from "@tm/enrich";
import {
  authenticityFactor,
  trustClaim,
  bandWidth,
  bountyAnchor,
  cohortScore,
  consolidateSignals,
  duplicatesFactor,
  failureEvidence,
  failureFactorV2,
  nicheFactor,
  rarityFactorV2,
  richnessFactorV2,
  traitPolicyV1,
  traitPolicyV2,
  type MarketContext,
  type MarketContextV2,
} from "./index";

const c = DEFAULT_CONFIG.pricing;
const v2 = c.v2;
const NOW = new Date("2026-10-15T12:00:00Z");

function traits(over: Partial<TraceTraits> = {}): TraceTraits {
  return {
    turns: 30,
    toolCalls: 12,
    toolErrors: 1,
    userCorrections: 0,
    interrupts: 0,
    hadFailure: true,
    recovered: true,
    preferencePairs: 0,
    testsRanAtEnd: true,
    testsPassedAtEnd: true,
    truncated: false,
    redactionDensity: 0,
    domain: "software_engineering",
    domainConfidence: 0.9,
    domains: [{ domain: "software_engineering", share: 1 }],
    distinctTools: 3,
    repeatRatio: 0,
    shapeKey: "",
    failureCategory: "tool_error",
    language: "TypeScript",
    framework: "React",
    model: "claude-sonnet-4-5",
    modelDeprecated: false,
    capturedAt: NOW.toISOString(),
    durationMinutes: 20,
    ...over,
  };
}

const cohort = (count: number, typical: number) => ({ count, typical });

function ctx(over: Partial<MarketContextV2> = {}): MarketContextV2 {
  return {
    cohorts: {
      domain: cohort(100, 60),
      failure: cohort(20, 15),
      stack: cohort(6, 4),
      model: cohort(40, 30),
    },
    niche: { domainDemand: 0, totalDemand: 0, domainSupply: 100, totalSupply: 200 },
    duplicates: 0,
    claimed: false,
    ...over,
  };
}

const market = (v: MarketContextV2 | undefined, over: Partial<MarketContext> = {}) => ({
  comboCount: 1,
  medianComboCount: 1,
  demandPressure: 0,
  now: NOW,
  v2: v,
  ...over,
});

const price = (t: TraceTraits, m: MarketContext, config = c) =>
  traitPolicyV2.price({ traits: t, tier: 0, license: "research", market: m, config });

describe("V2 factors", () => {
  it("scores a cohort's scarcity against the typical size, smoothed", () => {
    expect(cohortScore(cohort(10, 10), 2)).toBeCloseTo(1);
    expect(cohortScore(cohort(1, 10), 2)).toBeGreaterThan(1);
    expect(cohortScore(cohort(40, 10), 2)).toBeLessThan(1);
    // Smoothing: a cohort of one is rare, not infinitely so.
    expect(cohortScore(cohort(1, 10), 2)).toBeCloseTo(2);
    for (let n = 1; n < 50; n++) {
      expect(cohortScore(cohort(n + 1, 10), 2)).toBeLessThan(cohortScore(cohort(n, 10), 2));
    }
  });

  it("blends rarity domain first, and only uses the stack level with a big enough parent", () => {
    const base = ctx().cohorts;
    const withStack = rarityFactorV2(base, v2);
    expect(withStack.levels.stack).toBeDefined();
    const thin = rarityFactorV2({ ...base, failure: cohort(3, 15) }, v2);
    expect(thin.levels.stack).toBeUndefined();
    // A rare domain moves rarity more than a rare stack.
    const rareDomain = rarityFactorV2({ ...base, domain: cohort(5, 60) }, v2).value;
    const rareStack = rarityFactorV2({ ...base, stack: cohort(1, 4) }, v2).value;
    expect(rareDomain).toBeGreaterThan(rareStack);
    // Bounded both ways.
    const tiny = cohort(1, 1000);
    const huge = cohort(1000, 1);
    const all = (x: typeof tiny) => ({ domain: x, failure: x, stack: x, model: x });
    expect(rarityFactorV2(all(tiny), v2).value).toBe(v2.rarity.max);
    expect(rarityFactorV2(all(huge), v2).value).toBe(v2.rarity.min);
  });

  it("keeps the model's effect on rarity within ± the configured spread", () => {
    const base = ctx().cohorts;
    const a = rarityFactorV2({ ...base, model: cohort(1, 1000) }, v2).value;
    const b = rarityFactorV2({ ...base, model: cohort(1000, 1) }, v2).value;
    expect(a / b).toBeCloseTo((1 + v2.rarity.modelSpread) / (1 - v2.rarity.modelSpread), 5);
  });

  it("puts the niche factor at 1 with no demand, above 1 when demand outruns supply", () => {
    const n = (domainDemand: number, totalDemand: number) =>
      nicheFactor("medical", { domainDemand, totalDemand, domainSupply: 5, totalSupply: 200 }, v2)
        .value;
    expect(n(0, 0)).toBeCloseTo(1);
    expect(n(10, 20)).toBeGreaterThan(1);
    expect(n(0, 50)).toBeLessThan(1);
    expect(n(1e6, 1e6)).toBe(v2.niche.max);
    expect(nicheFactor("unknown", ctx().niche, v2).value).toBe(1);
  });

  it("applies a strategic domain weight, the platform's lever", () => {
    const weighted = { ...v2, niche: { ...v2.niche, strategicWeights: { medical: 1.3 } } };
    const n = { domainDemand: 0, totalDemand: 0, domainSupply: 5, totalSupply: 200 };
    expect(nicheFactor("medical", n, weighted).value).toBeCloseTo(1.3);
    expect(nicheFactor("legal", n, weighted).value).toBeCloseTo(1);
  });

  it("counts information, not length: repeats add little and more tools add a little", () => {
    const r = (o: Partial<TraceTraits>) => richnessFactorV2(traits(o), v2);
    expect(r({ repeatRatio: 0.8 })).toBeLessThan(r({ repeatRatio: 0 }));
    expect(r({ distinctTools: 5 })).toBeGreaterThan(r({ distinctTools: 1 }));
    expect(r({ turns: 10_000, distinctTools: 20 })).toBe(v2.richness.max);
    // Traits stored before V2 have no repeat or tool counts.
    expect(r({ repeatRatio: undefined, distinctTools: undefined })).toBeGreaterThan(1);
  });

  it("tiers failures by evidence: verified > inferred > attempted > none", () => {
    const f = (o: Partial<TraceTraits>) => failureFactorV2(traits(o), v2).value;
    const verified = f({});
    const inferred = f({ testsPassedAtEnd: false });
    const attempted = f({ recovered: false });
    const none = f({ hadFailure: false, recovered: false });
    expect(verified).toBeGreaterThan(inferred);
    expect(inferred).toBeGreaterThan(attempted);
    expect(attempted).toBeGreaterThan(none);
    expect(failureEvidence(traits({ testsPassedAtEnd: false }))).toBe("inferred");
    expect(f({ preferencePairs: 100 }) - verified).toBeCloseTo(v2.failure.maxPreferenceBonus);
  });

  it("discounts a seller's near-duplicates, down to a floor", () => {
    expect(duplicatesFactor(0, v2)).toBe(1);
    expect(duplicatesFactor(1, v2)).toBeLessThan(1);
    expect(duplicatesFactor(2, v2)).toBeLessThan(duplicatesFactor(1, v2));
    expect(duplicatesFactor(1000, v2)).toBe(v2.duplicates.floor);
  });

  it("pulls a price up towards an open bounty's offer, within bounds", () => {
    expect(bountyAnchor(4, undefined, v2)).toBe(4);
    expect(bountyAnchor(20, 2000, v2)).toBe(20); // already above 60% of $20
    const lifted = bountyAnchor(4, 2000, v2);
    expect(lifted).toBeGreaterThan(4);
    expect(lifted).toBeLessThanOrEqual(4 * v2.bounty.maxLift);
    expect(bountyAnchor(11, 2000, v2)).toBeCloseTo(12); // capped at the target
  });

  it("widens the band when the policy is less sure", () => {
    const w = (t: Partial<TraceTraits>, o: Partial<MarketContextV2> = {}) =>
      bandWidth(traits(t), ctx(o), v2);
    const sure = w({ domainConfidence: 1 });
    expect(sure).toBeCloseTo(v2.band.base);
    expect(w({ domain: "unknown" })).toBeGreaterThan(sure);
    expect(w({ domainConfidence: 1 }, { claimed: true })).toBeGreaterThan(sure);
    expect(
      w({ domainConfidence: 1 }, { cohorts: { ...ctx().cohorts, failure: cohort(1, 15) } }),
    ).toBeGreaterThan(sure);
    expect(
      w(
        { domain: "unknown" },
        { claimed: true, cohorts: { ...ctx().cohorts, failure: cohort(1, 1) } },
      ),
    ).toBeLessThanOrEqual(v2.band.max);
  });
});

describe("authenticity in pricing", () => {
  const auth = (level: "consistent" | "well_formed" | "flagged") => ({
    level,
    score: 1,
    checks: [],
  });

  it("prices flagged sessions down and treats unchecked ones as well-formed", () => {
    expect(authenticityFactor(traits({ authenticity: auth("consistent") }), v2).value).toBe(1);
    expect(authenticityFactor(traits({ authenticity: auth("flagged") }), v2).value).toBe(
      v2.authenticity.flagged,
    );
    expect(authenticityFactor(traits({ authenticity: undefined }), v2).level).toBe("well_formed");
    const p = (a: ReturnType<typeof auth>) =>
      price(traits({ authenticity: a }), market(ctx())).priceCents;
    expect(p(auth("flagged"))).toBeLessThan(p(auth("well_formed")));
    expect(p(auth("well_formed"))).toBeLessThan(p(auth("consistent")));
  });

  it("trusts a seller's domain claim less, and less still when the upload is inconsistent", () => {
    expect(trustClaim(2, false, false, v2)).toBe(2);
    expect(trustClaim(2, true, true, v2)).toBeLessThan(2);
    expect(trustClaim(2, true, false, v2)).toBeLessThan(trustClaim(2, true, true, v2));
    expect(trustClaim(0.7, true, false, v2)).toBeGreaterThan(0.7); // towards 1 from below too
    const rare = ctx({
      cohorts: {
        domain: cohort(3, 60),
        failure: cohort(2, 15),
        stack: cohort(1, 4),
        model: cohort(2, 30),
      },
    });
    const verified = price(traits({ domain: "legal" }), market(rare)).priceCents;
    const claimed = price(
      traits({ domain: "legal" }),
      market({ ...rare, claimed: true }),
    ).priceCents;
    expect(claimed).toBeLessThan(verified);
  });
});

describe("demand V2", () => {
  const sig = (buyer: string, daysAgo = 0, weight = 1) => ({
    criteria: { domain: "medical" },
    weight,
    createdAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    buyerOrgId: buyer,
    kind: "search",
  });
  const total = (xs: ReturnType<typeof consolidateSignals>) => xs.reduce((s, x) => s + x.weight, 0);

  it("counts one buyer repeating a search log-wise, many buyers linearly", () => {
    const one = consolidateSignals(
      Array.from({ length: 50 }, () => sig("a")),
      NOW,
      14,
      v2.demand,
    );
    const many = consolidateSignals(
      Array.from({ length: 50 }, (_, i) => sig(`b${i}`)),
      NOW,
      14,
      v2.demand,
    );
    expect(one).toHaveLength(1);
    expect(total(one)).toBeLessThan(5);
    expect(total(many)).toBeCloseTo(50);
  });

  it("halves a signal's weight every half-life and drops it after the window", () => {
    const [half] = consolidateSignals([sig("a", v2.demand.halfLifeDays)], NOW, 14, v2.demand);
    expect(half!.weight).toBeCloseTo(0.5);
    expect(consolidateSignals([sig("a", 15)], NOW, 14, v2.demand)).toEqual([]);
    expect(consolidateSignals([{ ...sig("a"), criteria: {} }], NOW, 14, v2.demand)).toEqual([]);
  });
});

describe("trait-v2 policy", () => {
  it("prices exactly as v1 when the market has no V2 data", () => {
    const t = traits();
    const m = market(undefined);
    const a = price(t, m);
    const b = traitPolicyV1.price({
      traits: t,
      tier: 0,
      license: "research",
      market: m,
      config: c,
    });
    expect(a.priceCents).toBe(b.priceCents);
    expect(a.policy).toBe("trait-v1");
  });

  it("is monotonic in supply, demand, age, evidence and duplicates", () => {
    const p = (t: Partial<TraceTraits>, o: Partial<MarketContextV2> = {}, m = {}) =>
      price(traits(t), market(ctx(o), m)).priceCents;
    const base = p({});
    expect(p({}, { cohorts: { ...ctx().cohorts, failure: cohort(80, 15) } })).toBeLessThan(base);
    expect(p({}, {}, { demandPressure: 1 })).toBeGreaterThan(base);
    expect(
      p({ capturedAt: new Date(NOW.getTime() - 200 * 86_400_000).toISOString() }),
    ).toBeLessThan(base);
    expect(p({ testsPassedAtEnd: false })).toBeLessThan(base);
    expect(p({}, { duplicates: 3 })).toBeLessThan(base);
    expect(p({}, { bountyAnchorCents: 5000 })).toBeGreaterThan(base);
  });

  it("prices a rare domain above a crowded one, all else equal", () => {
    const coding = price(traits(), market(ctx())).priceCents;
    const medical = price(
      traits({ domain: "medical", language: undefined, framework: undefined }),
      market(
        ctx({
          cohorts: {
            domain: cohort(5, 60),
            failure: cohort(2, 15),
            stack: cohort(2, 4),
            model: cohort(3, 30),
          },
          niche: { domainDemand: 0, totalDemand: 0, domainSupply: 5, totalSupply: 200 },
        }),
      ),
    ).priceCents;
    expect(medical).toBeGreaterThan(coding * 1.5);
  });

  it("explains every factor and gives a band around the price", () => {
    const q = price(traits(), market(ctx({ bountyAnchorCents: 9000, duplicates: 1 })));
    expect(q.policy).toBe("trait-v2");
    expect(q.drivers.map((d) => d.factor)).toEqual([
      "failure",
      "rarity",
      "niche",
      "demand",
      "bounty",
      "richness",
      "quality",
      "duplicates",
      "authenticity",
      "freshness",
    ]);
    for (const d of q.drivers) expect(d.reason.length).toBeGreaterThan(3);
    expect(q.drivers.find((d) => d.factor === "bounty")!.reason).toContain("$90.00");
    expect(q.drivers.find((d) => d.factor === "duplicates")!.reason).toContain("1 more session");
    expect(q.band!.lowCents).toBeLessThanOrEqual(q.priceCents);
    expect(q.band!.highCents).toBeGreaterThanOrEqual(q.priceCents);
  });

  it("stays within the floor and ceiling and keeps the band around the price, for any input", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
    for (let i = 0; i < 500; i++) {
      const n = () => 1 + Math.floor(rnd() * 300);
      const t = traits({
        turns: Math.floor(rnd() * 400),
        hadFailure: rnd() < 0.7,
        recovered: rnd() < 0.5,
        testsPassedAtEnd: rnd() < 0.5,
        preferencePairs: Math.floor(rnd() * 8),
        repeatRatio: rnd(),
        distinctTools: Math.floor(rnd() * 10),
        domain: pick(["software_engineering", "medical", "legal", "unknown"]),
        domainConfidence: rnd(),
        redactionDensity: rnd(),
        capturedAt: new Date(NOW.getTime() - rnd() * 800 * 86_400_000).toISOString(),
      });
      const q = price(
        t,
        market(
          ctx({
            cohorts: {
              domain: cohort(n(), n()),
              failure: cohort(n(), n()),
              stack: cohort(n(), n()),
              model: cohort(n(), n()),
            },
            niche: {
              domainDemand: rnd() * 50,
              totalDemand: 50,
              domainSupply: n(),
              totalSupply: 300,
            },
            duplicates: Math.floor(rnd() * 5),
            bountyAnchorCents: rnd() < 0.3 ? Math.floor(rnd() * 10_000) : undefined,
            claimed: rnd() < 0.5,
          }),
          { demandPressure: rnd() * 3 },
        ),
      );
      expect(q.priceCents).toBeGreaterThanOrEqual(c.floor * 100);
      expect(q.priceCents).toBeLessThanOrEqual(c.ceiling * 100);
      expect(q.band!.lowCents).toBeLessThanOrEqual(q.priceCents);
      expect(q.band!.highCents).toBeGreaterThanOrEqual(q.priceCents);
      expect(Number.isFinite(q.factors.multiplier)).toBe(true);
    }
  });
});

describe("pricing config", () => {
  it("defaults to V2 with the platform levers off", () => {
    const cfg = loadConfig();
    expect(cfg.pricing.policy).toBe("trait-v2");
    expect(cfg.pricing.v2.niche.strategicWeights).toEqual({});
    expect(cfg.revenue.sellerShareByDomain).toEqual({});
  });

  it("can fall back to v1 from the environment, and rejects bad rarity weights", () => {
    expect(loadConfig({ env: { PRICING_POLICY: "trait-v1" } }).pricing.policy).toBe("trait-v1");
    expect(() => loadConfig({ env: { PRICING_POLICY: "v9" } })).toThrow(/PRICING_POLICY/);
    expect(() =>
      loadConfig({
        fileOverrides: {
          pricing: { v2: { rarity: { weights: { domain: 0.9, failure: 0.3, stack: 0.2 } } } },
        },
      }),
    ).toThrow(/sum to 1/);
  });
});
