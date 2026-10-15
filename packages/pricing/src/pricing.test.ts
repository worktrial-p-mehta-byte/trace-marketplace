import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "@tm/config";
import type { TraceTraits } from "@tm/enrich";
import {
  demandFactor,
  demandPressure,
  failureFactor,
  freshnessFactor,
  matchesCriteria,
  median,
  qualityFactor,
  rarityFactor,
  richnessFactor,
  splitSale,
  traitPolicyV1,
  type MarketContext,
} from "./index";

const c = DEFAULT_CONFIG.pricing;
const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function traits(over: Partial<TraceTraits>): TraceTraits {
  return {
    turns: 20,
    toolCalls: 5,
    toolErrors: 0,
    userCorrections: 0,
    interrupts: 0,
    hadFailure: false,
    recovered: false,
    preferencePairs: 0,
    testsRanAtEnd: false,
    testsPassedAtEnd: false,
    truncated: false,
    redactionDensity: 0,
    model: "claude-sonnet-4-5",
    modelDeprecated: false,
    capturedAt: daysAgo(0),
    durationMinutes: 10,
    ...over,
  };
}

const market = (over: Partial<MarketContext>): MarketContext => ({
  comboCount: 40,
  medianComboCount: 40,
  demandPressure: 0,
  now: NOW,
  ...over,
});

describe("worked examples from the design doc", () => {
  it("prices an everyday TypeScript trace at about $1.76", () => {
    const q = traitPolicyV1.price({
      traits: traits({
        turns: 18,
        hadFailure: true,
        toolErrors: 1,
        failureCategory: "tool_error",
        language: "TypeScript",
        framework: "React",
        capturedAt: daysAgo(30),
      }),
      tier: 0,
      license: "research",
      market: market({ comboCount: 120, medianComboCount: 40 }),
      config: c,
    });
    expect(q.factors.quality).toBe(1);
    expect(q.factors.richness).toBeCloseTo(1.37, 2);
    expect(q.factors.failure).toBe(1.4);
    expect(q.factors.rarity).toBeCloseTo(0.58, 2);
    expect(q.factors.demand).toBe(1);
    expect(q.factors.freshness).toBeCloseTo(0.79, 2);
    expect(q.factors.multiplier).toBeCloseTo(0.88, 2);
    expect(q.priceCents).toBe(176);
  });

  it("prices a rare Rust async near-miss at about $22.72", () => {
    const q = traitPolicyV1.price({
      traits: traits({
        turns: 64,
        hadFailure: true,
        recovered: true,
        preferencePairs: 2,
        testsRanAtEnd: true,
        testsPassedAtEnd: true,
        failureCategory: "retry_loop",
        language: "Rust",
        framework: "Tokio",
        capturedAt: daysAgo(12),
      }),
      tier: 0,
      license: "research",
      // Demand pressure 0.4 gives D = 1.2, as from an open bounty.
      market: market({ comboCount: 6, medianComboCount: 40, demandPressure: 0.4 }),
      config: c,
    });
    expect(q.factors.quality).toBeCloseTo(1.1, 5);
    expect(q.factors.richness).toBeCloseTo(1.83, 2);
    expect(q.factors.failure).toBeCloseTo(2.0, 5);
    expect(q.factors.rarity).toBeCloseTo(2.58, 2);
    expect(q.factors.demand).toBeCloseTo(1.2, 5);
    expect(q.factors.freshness).toBeCloseTo(0.91, 2);
    expect(q.factors.multiplier).toBeCloseTo(11.36, 2);
    expect(q.factors.capped).toBe(false);
    expect(q.priceCents).toBe(2272);
    expect(q.summary).toMatch(/^Raised by rarity 2\.6× and failure 2\.0×/);
  });

  it("applies the license factor at quote time", () => {
    const args = {
      traits: traits({}),
      tier: 0 as const,
      market: market({}),
      config: c,
    };
    const research = traitPolicyV1.price({ ...args, license: "research" }).priceCents;
    const training = traitPolicyV1.price({ ...args, license: "training" }).priceCents;
    expect(training).toBe(research * 2);
  });
});

describe("caps and limits", () => {
  it("caps the combined multiplier at 12×", () => {
    const q = traitPolicyV1.price({
      traits: traits({
        turns: 500,
        hadFailure: true,
        recovered: true,
        preferencePairs: 9,
        testsRanAtEnd: true,
      }),
      tier: 0,
      license: "research",
      market: market({ comboCount: 1, medianComboCount: 100, demandPressure: 10 }),
      config: c,
    });
    expect(q.factors.rawMultiplier).toBeGreaterThan(12);
    expect(q.factors.multiplier).toBe(12);
    expect(q.factors.capped).toBe(true);
    expect(q.priceCents).toBe(2400);
  });

  it("clamps to the ceiling and floor", () => {
    const rich = traitPolicyV1.price({
      traits: traits({ turns: 500, hadFailure: true, recovered: true, testsRanAtEnd: true }),
      tier: 0,
      license: "training",
      market: market({ comboCount: 1, medianComboCount: 100, demandPressure: 10 }),
      config: { ...c, ceiling: 30 },
    });
    expect(rich.priceCents).toBe(3000);
    const poor = traitPolicyV1.price({
      traits: traits({ turns: 0, capturedAt: daysAgo(900), modelDeprecated: true }),
      tier: 1,
      license: "research",
      market: market({ comboCount: 500, medianComboCount: 5 }),
      config: c,
    });
    expect(poor.priceCents).toBe(10);
  });

  it("refuses to price tiers that v0 does not support", () => {
    expect(() =>
      traitPolicyV1.price({
        traits: traits({}),
        tier: 3,
        license: "research",
        market: market({}),
        config: c,
      }),
    ).toThrow(/Tier 3/);
  });

  it("follows config changes, e.g. a lower cap", () => {
    const cfg = loadConfig({ fileOverrides: { pricing: { multiplierCap: 5 } } }).pricing;
    const q = traitPolicyV1.price({
      traits: traits({ turns: 200, hadFailure: true, recovered: true }),
      tier: 0,
      license: "research",
      market: market({ comboCount: 1, medianComboCount: 50 }),
      config: cfg,
    });
    expect(q.factors.multiplier).toBe(5);
  });
});

describe("individual factors", () => {
  it("quality penalises redaction and truncation, rewards checkable outcomes", () => {
    expect(
      qualityFactor({ redactionDensity: 0.25, truncated: true, testsRanAtEnd: false }, c),
    ).toBe(0.5);
    expect(
      qualityFactor({ redactionDensity: 0.05, truncated: false, testsRanAtEnd: true }, c),
    ).toBe(1.1);
  });

  it("richness grows with turns and is capped", () => {
    expect(richnessFactor({ turns: 0 }, c)).toBe(1);
    expect(richnessFactor({ turns: 20 }, c)).toBeCloseTo(1.4, 5);
    expect(richnessFactor({ turns: 10_000 }, c)).toBe(2);
  });

  it("failure rewards recovery and preference pairs, with a bonus cap", () => {
    expect(failureFactor({ hadFailure: false, recovered: false, preferencePairs: 3 }, c)).toBe(1);
    expect(failureFactor({ hadFailure: true, recovered: false, preferencePairs: 0 }, c)).toBe(1.4);
    expect(
      failureFactor({ hadFailure: true, recovered: true, preferencePairs: 10 }, c),
    ).toBeCloseTo(2.2, 5);
  });

  it("rarity is bounded and neutral for an empty catalog", () => {
    expect(rarityFactor(1, 1000, c)).toBe(3);
    expect(rarityFactor(1000, 1, c)).toBe(0.5);
    expect(rarityFactor(5, 0, c)).toBe(1);
  });

  it("demand is bounded and limited relative to the baseline", () => {
    expect(demandFactor(0, c)).toBe(1);
    expect(demandFactor(100, c)).toBe(2);
    expect(demandFactor(100, c, 1.0)).toBeCloseTo(1.2, 5); // max +20% vs baseline
    expect(demandFactor(0, c, 1.5)).toBeCloseTo(1.2, 5); // max −20% vs baseline
  });

  it("freshness halves every 90 days, has a floor, and penalises deprecated models", () => {
    expect(
      freshnessFactor({ capturedAt: daysAgo(90), modelDeprecated: false }, NOW, c),
    ).toBeCloseTo(0.5, 5);
    expect(freshnessFactor({ capturedAt: daysAgo(1000), modelDeprecated: false }, NOW, c)).toBe(
      0.4,
    );
    expect(freshnessFactor({ capturedAt: daysAgo(0), modelDeprecated: true }, NOW, c)).toBeCloseTo(
      0.7,
      5,
    );
  });
});

describe("demand matching", () => {
  const rust = {
    language: "Rust",
    framework: "Tokio",
    failureCategory: "retry_loop" as const,
    model: "m",
  };

  it("matches when every set criterion matches, case-insensitively", () => {
    expect(matchesCriteria(rust, { language: "rust" })).toBe(true);
    expect(matchesCriteria(rust, { language: "Rust", failure: "retry_loop" })).toBe(true);
    expect(matchesCriteria(rust, { language: "Go" })).toBe(false);
    expect(matchesCriteria({ ...rust, framework: undefined }, { framework: "Tokio" })).toBe(false);
  });

  it("spreads each signal's weight over the listings it matches and ignores old or empty signals", () => {
    const signals = [
      { criteria: { language: "Rust" }, weight: 4, createdAt: NOW }, // 4 Rust listings → 1.0
      { criteria: { failure: "retry_loop" }, weight: 1, createdAt: NOW }, // 10 listings → 0.1
      { criteria: { language: "Rust" }, weight: 9, createdAt: new Date("2026-01-01") }, // too old
      { criteria: {}, weight: 9, createdAt: NOW }, // matches everything: ignored
      { criteria: { language: "Go" }, weight: 9, createdAt: NOW }, // no match
    ];
    const supply = (cr: { language?: string }) => (cr.language === "Rust" ? 4 : 10);
    expect(demandPressure(rust, signals, supply, NOW, 14)).toBeCloseTo(1.1, 5);
  });

  it("computes medians", () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("explanations and seller split", () => {
  it("explains every factor in plain words", () => {
    const q = traitPolicyV1.price({
      traits: traits({
        turns: 64,
        toolCalls: 30,
        hadFailure: true,
        recovered: true,
        preferencePairs: 2,
        failureCategory: "test_tampering",
        language: "Rust",
        capturedAt: daysAgo(12),
        testsRanAtEnd: true,
      }),
      tier: 0,
      license: "research",
      market: market({ comboCount: 6, medianComboCount: 40, demandPressure: 0.4 }),
      config: c,
    });
    const byFactor = Object.fromEntries(q.drivers.map((d) => [d.factor, d]));
    expect(byFactor.failure!.reason).toBe(
      "agent tampered with a failing test, then recovered; 2 preference pairs",
    );
    expect(byFactor.rarity!.reason).toBe("Rust + test_tampering: seen 6× (typical 40×)");
    expect(byFactor.freshness!.reason).toBe("12 days old");
    expect(byFactor.quality!.reason).toBe("outcome checked by tests");
    expect(byFactor.demand!.direction).toBe("up");
  });

  it("splits sales by the configured share, adding up exactly", () => {
    expect(splitSale(2272, 0.7)).toEqual({ seller: 1591, platform: 681 });
    expect(splitSale(1, 0.7)).toEqual({ seller: 1, platform: 0 });
    for (const cents of [0, 99, 176, 5000]) {
      const s = splitSale(cents, 0.7);
      expect(s.seller + s.platform).toBe(cents);
    }
  });
});
