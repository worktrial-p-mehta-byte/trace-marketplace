import { describe, expect, it } from "vitest";
import { DOMAIN_IDS, enrichTrace } from "@tm/enrich";
import { Trace } from "@tm/schema";
import {
  createRng,
  domainOf,
  generateCatalog,
  generateCatalogWithSpecs,
  generateFlood,
  generateTrace,
  packOf,
  PACKS,
  randomSpec,
  STACKS,
  type Pattern,
} from "./index";

const NOW = new Date("2026-10-15T12:00:00Z");

describe("synthetic generator", () => {
  it("is deterministic for a seed and produces valid traces", () => {
    const a = generateCatalog(7, 30, NOW);
    const b = generateCatalog(7, 30, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const t of a) expect(Trace.safeParse(t).success).toBe(true);
    expect(a.every((t) => t.provenance.source === "synthetic")).toBe(true);
  });

  it.each<[Pattern, string | undefined]>([
    ["clean", undefined],
    ["tool_error", "tool_error"],
    ["retry_loop", "retry_loop"],
    ["user_correction", "user_correction"],
    ["tool_rejected", "tool_rejected"],
    ["user_interrupt", "user_interrupt"],
    ["test_tampering", "test_tampering"],
  ])("pattern %s is labelled %s by the real enrich pipeline", (pattern, failure) => {
    const rng = createRng(1);
    for (const stack of STACKS) {
      if (pattern === "test_tampering" && !packOf(stack).tampering) continue;
      for (const recovered of [true, false]) {
        const t = generateTrace(
          rng,
          { ...randomSpec(rng), stack, pattern, recovered },
          { now: NOW, index: 1 },
        );
        const { traits } = enrichTrace(t);
        expect(traits.failureCategory).toBe(failure);
        expect(traits.language).toBe(stack.language);
        if (pattern !== "clean") expect(traits.recovered).toBe(recovered);
      }
    }
  });

  it("only coding packs tamper with tests", () => {
    const rng = createRng(2);
    const medical = PACKS.find((p) => p.domain === "medical")!.stacks[0]!;
    expect(() =>
      generateTrace(
        rng,
        { ...randomSpec(rng), stack: medical, pattern: "test_tampering" },
        { now: NOW, index: 1 },
      ),
    ).toThrow(/no tests to tamper with/);
    const flood = generateFlood(3, 4, NOW, { domain: "medical", pattern: "test_tampering" });
    for (const t of flood) expect(enrichTrace(t).traits.failureCategory).toBe("tool_error");
  });

  it("detects each stack's framework", () => {
    const rng = createRng(3);
    for (const stack of STACKS.filter((s) => s.framework)) {
      const t = generateTrace(
        rng,
        { ...randomSpec(rng), stack, pattern: "clean" },
        { now: NOW, index: 2 },
      );
      expect(enrichTrace(t).traits.framework).toBe(stack.framework);
    }
  });

  it("makes common stacks common and niche ones rare", () => {
    const langs = generateCatalog(42, 400, NOW).map((t) => t.provenance.repo.languages[0]);
    const n = (l: string) => langs.filter((x) => x === l).length;
    expect(n("TypeScript")).toBeGreaterThan(n("Rust") * 4);
    expect(n("COBOL")).toBeLessThan(6);
  });

  it("floods one stack and pattern with recent, distinct sessions", () => {
    const f = generateFlood(9, 10, NOW, {
      language: "Rust",
      framework: "Tokio",
      pattern: "retry_loop",
    });
    expect(new Set(f.map((t) => JSON.stringify(t.events))).size).toBe(10);
    for (const t of f) {
      const { traits } = enrichTrace(t);
      expect([traits.language, traits.framework, traits.failureCategory]).toEqual([
        "Rust",
        "Tokio",
        "retry_loop",
      ]);
      expect(NOW.getTime() - Date.parse(t.endedAt)).toBeLessThan(8 * 86_400_000);
    }
  });

  it("floods one domain across its stacks", () => {
    const f = generateFlood(11, 12, NOW, { domain: "data_querying", pattern: "user_correction" });
    const frameworks = new Set<string | undefined>();
    for (const t of f) {
      const { traits } = enrichTrace(t);
      expect(traits.domain).toBe("data_querying");
      expect(traits.failureCategory).toBe("user_correction");
      frameworks.add(traits.framework);
    }
    expect(frameworks.size).toBeGreaterThan(1);
    expect(() => generateFlood(1, 1, NOW, { domain: "astrology", pattern: "clean" })).toThrow(
      /Unknown domain/,
    );
    expect(() =>
      generateFlood(1, 1, NOW, { domain: "medical", language: "Rust", pattern: "clean" }),
    ).toThrow(/No stack/);
  });

  it("never puts timestamps after the session end or after now", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    for (const t of generateCatalog(42, 200, now)) {
      const last = t.events.at(-1)!.ts!;
      expect(t.endedAt).toBe(last);
      expect(t.provenance.capturedAt).toBe(last);
      expect(Date.parse(last)).toBeLessThanOrEqual(now.getTime());
      for (let i = 1; i < t.events.length; i++) {
        expect(t.events[i]!.ts! >= t.events[i - 1]!.ts!).toBe(true);
      }
    }
  });

  it("keeps long sessions that end today in the past", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    for (let seed = 1; seed <= 200; seed++) {
      const rng = createRng(seed);
      const spec = { ...randomSpec(rng), ageDays: 0, turns: 118, pattern: "retry_loop" as Pattern };
      const t = generateTrace(rng, spec, { now, index: seed });
      expect(Date.parse(t.endedAt), `seed ${seed}`).toBeLessThanOrEqual(now.getTime());
    }
  });
});

describe("domains", () => {
  it("uses the labeler's domain ids", () => {
    for (const p of PACKS) expect(DOMAIN_IDS).toContain(p.domain);
    expect(new Set(PACKS.map((p) => p.domain)).size).toBe(DOMAIN_IDS.length - 1); // all but unknown
  });

  it("gives the catalog a long tail of domains, coding first", { timeout: 60_000 }, () => {
    const rows = generateCatalogWithSpecs(42, 1500, NOW);
    const counts = new Map<string, number>();
    for (const { spec } of rows) counts.set(domainOf(spec), (counts.get(domainOf(spec)) ?? 0) + 1);
    for (const p of PACKS) expect(counts.get(p.domain), p.domain).toBeGreaterThan(0);
    const coding = counts.get("software_engineering")!;
    expect(coding / rows.length).toBeGreaterThan(0.5);
    expect(coding / rows.length).toBeLessThan(0.65);
    expect(counts.get("data_querying")!).toBeGreaterThan(counts.get("medical")!);
    expect(counts.get("medical")!).toBeGreaterThan(counts.get("legal")!);
  });

  it("is what the real labeler detects, with confidence", { timeout: 60_000 }, () => {
    const rows = generateCatalogWithSpecs(42, 1500, NOW);
    let right = 0;
    const perDomain = new Map<string, { n: number; right: number; lowConfidence: number }>();
    for (const { trace, spec } of rows) {
      const want = domainOf(spec);
      const { traits, labels } = enrichTrace(trace);
      const d = perDomain.get(want) ?? { n: 0, right: 0, lowConfidence: 0 };
      d.n++;
      if (traits.domain === want) {
        right++;
        d.right++;
      }
      if (traits.domainConfidence < 0.6) d.lowConfidence++;
      perDomain.set(want, d);
      const label = labels.find((l) => l.kind === "domain");
      expect(label?.code).toBe(traits.domain);
      expect(label?.evidence.length).toBeGreaterThan(0);
    }
    expect(right / rows.length).toBeGreaterThanOrEqual(0.98);
    for (const [domain, d] of perDomain) {
      expect(d.right / d.n, domain).toBeGreaterThanOrEqual(0.95);
      expect(d.lowConfidence / d.n, `${domain} low confidence`).toBeLessThan(0.1);
    }
  });

  it("records the harness each kind of work came from", () => {
    const harnesses = new Set(generateCatalog(5, 300, NOW).map((t) => t.provenance.harness.name));
    expect(harnesses.has("claude-code")).toBe(true);
    expect(harnesses.has("agent-sdk")).toBe(true);
  });
});
