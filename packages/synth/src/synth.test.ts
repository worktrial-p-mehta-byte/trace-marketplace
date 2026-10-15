import { describe, expect, it } from "vitest";
import { enrichTrace } from "@tm/enrich";
import { Trace } from "@tm/schema";
import {
  createRng,
  generateCatalog,
  generateFlood,
  generateTrace,
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
