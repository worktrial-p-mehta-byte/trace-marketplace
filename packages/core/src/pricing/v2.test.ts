import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadConfig } from "@tm/config";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { enrichTrace } from "@tm/enrich";
import { generateCatalog, generateFlood } from "@tm/synth";
import {
  buildMarket,
  compareInWindTunnel,
  createDbEventBus,
  createMemoryBlobStore,
  ensureAccount,
  estimatePrice,
  listSellerTraces,
  postBounty,
  repriceAll,
  shadowReport,
  shareTrace,
  type CatalogDeps,
} from "../index";

const NOW = new Date("2026-10-15T12:00:00Z");
let db: Db;
let deps: CatalogDeps;
let sellerId: string;

beforeEach(async () => {
  db = openDb(":memory:");
  runMigrations(db);
  deps = {
    config: loadConfig(),
    bus: createDbEventBus(db),
    blobs: createMemoryBlobStore(),
    now: NOW,
  };
  sellerId = (await ensureAccount(db, "seed@example.com", "seller", "Seed")).id;
  for (const trace of generateCatalog(11, 120, NOW)) {
    await shareTrace(
      db,
      deps,
      { sellerId, trace, tier: 0 },
      { allowSynthetic: true, deferMarket: true },
    );
  }
  repriceAll(db, { ...deps, reason: "seed" });
});

const SYNTH = { allowSynthetic: true };
const listingOf = (traceId: string) =>
  db.select().from(schema.listings).where(eq(schema.listings.traceId, traceId)).get()!;

describe("Pricing V2 in the market", () => {
  it("is the default policy and explains niche, bounty and duplicates on every listing", () => {
    const m = buildMarket(db, deps);
    expect(m.policy.name).toBe("trait-v2");
    const q = m.quote(m.active[0]!);
    expect(q.policy).toBe("trait-v2");
    expect(q.drivers.map((d) => d.factor)).toContain("niche");
    expect(q.band!.lowCents).toBeLessThanOrEqual(q.priceCents);
  });

  it("falls back to v1 when configured", () => {
    const v1 = { ...deps, config: loadConfig({ env: { PRICING_POLICY: "trait-v1" } }) };
    const m = buildMarket(db, v1);
    expect(m.policy.name).toBe("trait-v1");
    expect(m.quote(m.active[0]!).band).toBeUndefined();
  });

  it("discounts a seller re-listing the same session shape, not another seller's", async () => {
    const [a, b] = generateFlood(77, 2, NOW, { domain: "legal", pattern: "user_correction" });
    // The same session with the text changed: a new content hash, the same shape.
    const twin = {
      ...a!,
      id: "twin",
      events: a!.events.map((e) =>
        e.type === "user_message" ? { ...e, text: `${e.text} (v2)` } : e,
      ),
    };
    const r1 = await shareTrace(db, deps, { sellerId, trace: a!, tier: 0 }, SYNTH);
    const solo = listingOf(r1.traceId).currentPriceCents!;
    await shareTrace(db, deps, { sellerId, trace: twin, tier: 0 }, SYNTH);
    expect(listingOf(r1.traceId).currentPriceCents!).toBeLessThan(solo * 0.8);
    // Another seller's copy of a different session does not count against them.
    const other = (await ensureAccount(db, "other@example.com", "seller", "Other")).id;
    const before = listingOf(r1.traceId).currentPriceCents!;
    await shareTrace(db, deps, { sellerId: other, trace: b!, tier: 0 }, SYNTH);
    expect(Math.abs(listingOf(r1.traceId).currentPriceCents! / before - 1)).toBeLessThan(0.1);
  });

  it("estimates a batch of same-shape sessions at the price they list at together", async () => {
    const [a] = generateFlood(78, 1, NOW, { domain: "legal", pattern: "tool_error" });
    const twin = {
      ...a!,
      id: "twin2",
      events: a!.events.map((e) =>
        e.type === "user_message" ? { ...e, text: `${e.text} (b)` } : e,
      ),
    };
    const { traits } = enrichTrace(a!);
    const alone = estimatePrice(db, deps, traits, 0, { sellerId });
    const batch = estimatePrice(db, deps, traits, 0, { sellerId, pendingSameShape: 1 });
    expect(batch.priceCents).toBeLessThan(alone.priceCents);
    const r = await shareTrace(db, deps, { sellerId, trace: a!, tier: 0 }, SYNTH);
    await shareTrace(db, deps, { sellerId, trace: twin, tier: 0 }, SYNTH);
    expect(Math.abs(listingOf(r.traceId).currentPriceCents! / batch.priceCents - 1)).toBeLessThan(
      0.05,
    );
  });

  it("judges the model's scarcity within the domain, not across the market", () => {
    const m = buildMarket(db, deps);
    const row = m.active.find((r) => r.traits.domain === "software_engineering")!;
    const ctx = m.contextFor(row.traits, { tier: 0 })!;
    // The typical model cohort in coding is far bigger than one in a small domain.
    const small = m.active.find(
      (r) => r.traits.domain === "education" || r.traits.domain === "legal",
    );
    if (small) {
      const sctx = m.contextFor(small.traits, { tier: 0 })!;
      expect(sctx.cohorts.model.typical).toBeLessThan(ctx.cohorts.model.typical);
    }
    expect(ctx.cohorts.model.typical).toBeLessThanOrEqual(ctx.cohorts.domain.count + 1);
  });

  it("anchors matching prices to an open bounty's offer", async () => {
    const buyer = (await ensureAccount(db, "lab@example.com", "buyer", "Lab")).buyerOrgId!;
    const [t] = generateFlood(5, 1, NOW, { domain: "finance", pattern: "tool_error" });
    const r = await shareTrace(db, deps, { sellerId, trace: t!, tier: 0 }, SYNTH);
    const before = listingOf(r.traceId).currentPriceCents!;
    postBounty(db, deps, {
      buyerOrgId: buyer,
      title: "finance errors",
      criteria: { domain: "finance", failure: "tool_error" },
      perTraceCents: 4000,
      quantity: 1, // small budget: hardly any demand pressure, so the anchor does the work
      now: NOW,
    });
    const m = buildMarket(db, deps);
    const q = m.quote(m.active.find((x) => x.traceId === r.traceId)!);
    expect(q.factors.bounty).toBeGreaterThan(1);
    expect(q.priceCents).toBeGreaterThan(before);
    expect(q.priceCents).toBeLessThanOrEqual(Math.ceil(4000 * 0.6));
  });

  it("estimates like it will price: the estimate matches the listed price", async () => {
    const [t] = generateFlood(9, 1, NOW, { domain: "education", pattern: "retry_loop" });
    const { traits } = enrichTrace(t!);
    const est = estimatePrice(db, deps, traits, 0, { sellerId });
    const r = await shareTrace(db, deps, { sellerId, trace: t!, tier: 0 }, SYNTH);
    expect(Math.abs(r.priceCents - est.priceCents)).toBeLessThanOrEqual(1);
  });

  it("pays a per-domain seller share when one is configured", async () => {
    const cfg = loadConfig({
      fileOverrides: { revenue: { sellerShareByDomain: { medical: 0.8 } } },
    });
    const [t] = generateFlood(3, 1, NOW, { domain: "medical", pattern: "clean" });
    const r = await shareTrace(
      db,
      { ...deps, config: cfg },
      { sellerId, trace: t!, tier: 0 },
      SYNTH,
    );
    expect(r.sellerCents).toBe(Math.ceil(r.priceCents * 0.8));
    const row = listSellerTraces(db, sellerId, cfg).find((x) => x.traceId === r.traceId)!;
    expect(row.sellerCents).toBe(Math.ceil(r.priceCents * 0.8));
  });

  it("reports both policies side by side, and V2 earns more in the wind tunnel", () => {
    const report = shadowReport(db, deps);
    expect(report.rows).toHaveLength(120);
    const coding = report.byDomain.find((d) => d.domain === "software_engineering")!;
    const tail = report.byDomain.filter((d) => d.domain !== "software_engineering");
    // V2 moves money towards the long tail of domains.
    for (const d of tail) expect(d.medianRatio).toBeGreaterThan(coding.medianRatio);
    const { v1, v2 } = compareInWindTunnel(db, deps);
    expect(v2.revenueCents).toBeGreaterThan(v1.revenueCents);
  });
});
