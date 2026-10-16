import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadConfig } from "@tm/config";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { generateCatalog, generateFlood } from "@tm/synth";
import {
  createDbEventBus,
  createMemoryBlobStore,
  createSqliteSearchIndex,
  ensureAccount,
  getBuyerPreferences,
  listSavedSearches,
  PreferencesError,
  ensureWelcomeCredits,
  placeOrder,
  quoteCart,
  quoteListing,
  recommendFor,
  recordDemandSignal,
  saveSearch,
  repriceAll,
  setBuyerPreferences,
  shareTrace,
  suggestedCampaign,
  type CatalogDeps,
  type PublicUser,
} from "../index";

const NOW = new Date("2026-10-15T12:00:00Z");
let db: Db;
let deps: CatalogDeps & { search: NonNullable<CatalogDeps["search"]> };
let buyer: PublicUser;

beforeEach(async () => {
  db = openDb(":memory:");
  runMigrations(db);
  deps = {
    config: loadConfig(),
    bus: createDbEventBus(db),
    blobs: createMemoryBlobStore(),
    search: createSqliteSearchIndex(db),
    now: NOW,
  };
  const seller = await ensureAccount(db, "s@example.com", "seller", "S");
  const traces = [
    ...generateCatalog(21, 50, NOW),
    ...generateFlood(22, 4, NOW, { domain: "medical", pattern: "user_correction" }),
    ...generateFlood(23, 4, NOW, { domain: "medical", pattern: "clean" }),
  ];
  for (const trace of traces)
    await shareTrace(
      db,
      deps,
      { sellerId: seller.id, trace, tier: 0 },
      { allowSynthetic: true, deferMarket: true },
    );
  repriceAll(db, { ...deps, reason: "seed" });
  buyer = await ensureAccount(db, "lab@example.com", "buyer", "Lab");
});

describe("buyer preferences", () => {
  it("stores the answers, cleans them, and records them as demand", () => {
    const p = setBuyerPreferences(db, deps, buyer, {
      domains: ["medical", "astrology", "medical"],
      failures: ["user_correction", "nonsense"],
      license: "eval",
      contentNeeded: true,
      maxPriceCents: 1200,
    });
    expect(p).toEqual({
      domains: ["medical"],
      failures: ["user_correction"],
      license: "eval",
      contentNeeded: true,
      maxPriceCents: 1200,
    });
    expect(getBuyerPreferences(db, buyer.buyerOrgId!)).toEqual(p);
    const save = db.select().from(schema.demandSignals).all().at(-1)!;
    expect(save).toMatchObject({
      kind: "save",
      criteria: { domain: "medical", failure: "user_correction" },
    });
    // Updating replaces, and the answers never show up as a saved search.
    setBuyerPreferences(db, deps, buyer, { domains: ["legal"] });
    expect(getBuyerPreferences(db, buyer.buyerOrgId!)!.domains).toEqual(["legal"]);
    expect(listSavedSearches(db, buyer.buyerOrgId!)).toEqual([]);
  });

  it("needs a domain and a buyer account", async () => {
    expect(() => setBuyerPreferences(db, deps, buyer, { domains: [] })).toThrow(PreferencesError);
    const seller = await ensureAccount(db, "s@example.com", "seller", "S");
    expect(() => setBuyerPreferences(db, deps, seller, { domains: ["medical"] })).toThrow(
      /buyer accounts/,
    );
  });

  it("picks traces in the buyer's domains, wanted behaviour first, at most two of a shape", async () => {
    const p = setBuyerPreferences(db, deps, buyer, {
      domains: ["medical"],
      failures: ["user_correction"],
    });
    const picks = await recommendFor(db, deps, p, 6);
    expect(picks.length).toBeGreaterThan(0);
    for (const i of picks) expect(i.domain).toBe("medical");
    expect(picks[0]!.failures).toContain("user_correction");
    const shapes = new Map<string, number>();
    for (const i of picks)
      if (i.shapeKey) shapes.set(i.shapeKey, (shapes.get(i.shapeKey) ?? 0) + 1);
    for (const n of shapes.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("keeps picks within the stated budget", async () => {
    const open = { domains: ["medical"], failures: ["user_correction"] };
    const all = await recommendFor(db, deps, setBuyerPreferences(db, deps, buyer, open), 20);
    const budgetCents = Math.round(Math.min(...all.map((i) => i.priceCents)) * 1.2);
    const picks = await recommendFor(
      db,
      deps,
      setBuyerPreferences(db, deps, buyer, { ...open, maxPriceCents: budgetCents }),
      20,
    );
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThan(all.length);
    for (const i of picks) expect(i.priceCents).toBeLessThanOrEqual(budgetCents);
  });

  it("prices picks under the team's licence, and budgets against that price", async () => {
    const open = { domains: ["medical"], license: "training" as const };
    const all = await recommendFor(db, deps, setBuyerPreferences(db, deps, buyer, open), 20);
    for (const i of all)
      expect(i.priceCents).toBe(quoteListing(db, i.listingId, "training", deps)!.priceCents);
    // A budget the research price fits but the training price doesn't.
    const cheapest = Math.min(...all.map((i) => i.priceCents));
    const picks = await recommendFor(
      db,
      deps,
      setBuyerPreferences(db, deps, buyer, { ...open, maxPriceCents: cheapest - 1 }),
      20,
    );
    expect(picks).toEqual([]);
  });

  it("only picks listings offered under the team's licence", async () => {
    const p = setBuyerPreferences(db, deps, buyer, { domains: ["medical"], license: "training" });
    const before = await recommendFor(db, deps, p, 50);
    expect(before.length).toBeGreaterThan(0);
    db.update(schema.listings)
      .set({ allowedLicenses: ["research"] })
      .where(eq(schema.listings.id, before[0]!.listingId))
      .run();
    const after = await recommendFor(db, deps, p, 50);
    expect(after.map((i) => i.listingId)).not.toContain(before[0]!.listingId);
  });

  it("never picks the team's own members' listings", async () => {
    const both = await ensureAccount(db, "both@example.com", "both", "Both");
    const [own] = generateFlood(31, 1, NOW, { domain: "legal", pattern: "user_correction" });
    const r = await shareTrace(
      db,
      deps,
      { sellerId: both.id, trace: own!, tier: 0 },
      { allowSynthetic: true },
    );
    const p = setBuyerPreferences(db, deps, both, { domains: ["legal"] });
    const forTeam = await recommendFor(db, deps, p, 50, both.buyerOrgId!);
    expect(forTeam.map((i) => i.listingId)).not.toContain(r.listingId);
    const forAnyone = await recommendFor(db, deps, p, 50);
    expect(forAnyone.map((i) => i.listingId)).toContain(r.listingId);
  });

  it("keeps the answers apart from a saved search that happens to be called Preferences", () => {
    const p = setBuyerPreferences(db, deps, buyer, { domains: ["medical"] });
    saveSearch(db, deps, buyer, { name: "Preferences", query: { domain: "legal" } });
    expect(getBuyerPreferences(db, buyer.buyerOrgId!)).toEqual(p);
    expect(listSavedSearches(db, buyer.buyerOrgId!).map((x) => x.name)).toEqual(["Preferences"]);
  });

  it("suggests a campaign the campaign form understands", () => {
    expect(
      suggestedCampaign({
        domains: ["medical"],
        failures: ["user_correction"],
        license: "training",
        contentNeeded: false,
        maxPriceCents: 900,
      }),
    ).toEqual({
      describe: "medical user correction",
      maxPrice: "9.00",
      license: "training",
    });
  });
});

describe("picks that learn from behaviour", () => {
  const view = (orgId: string, criteria: Record<string, string>, daysAgo = 0) =>
    recordDemandSignal(db, deps.bus, {
      kind: "view",
      criteria,
      weight: 0.05,
      buyerOrgId: orgId,
      now: new Date(NOW.getTime() - daysAgo * 86_400_000),
    });

  it("picks from what a team views, with no onboarding answers, and says why", async () => {
    const org = buyer.buyerOrgId!;
    expect(await recommendFor(db, deps, undefined, 6, org)).toEqual([]);
    view(org, { domain: "medical", failure: "user_correction" });
    view(org, { domain: "medical" });
    const picks = await recommendFor(db, deps, undefined, 6, org);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks[0]!.domain).toBe("medical");
    expect(picks[0]!.pickReason).toMatch(/^Because your team viewed/);
  });

  it("weighs a purchase above views, and never picks what the team holds", async () => {
    const org = buyer.buyerOrgId!;
    ensureWelcomeCredits(db, deps.config, buyer.buyerOrgId!);
    for (let k = 0; k < 2; k++) view(org, { domain: "medical" });
    const research = await recommendFor(db, deps, undefined, 50, org);
    // Buy one data-querying session.
    const all = await recommendFor(
      db,
      deps,
      { domains: ["data_querying"], failures: [], license: "research", contentNeeded: false },
      50,
    );
    const target = all[0]!;
    placeOrder(db, deps, buyer, quoteCart(db, deps, buyer, "research", [target.listingId]).id);
    const picks = await recommendFor(db, deps, undefined, 50, org);
    expect(picks.map((p) => p.listingId)).not.toContain(target.listingId);
    expect(picks[0]!.domain).toBe("data_querying");
    expect(picks.find((p) => p.domain === "data_querying")!.pickReason).toMatch(/your team bought/);
    expect(research.every((p) => p.domain === "medical")).toBe(true);
  });

  it("lets old behaviour fade", async () => {
    const org = buyer.buyerOrgId!;
    for (let k = 0; k < 3; k++) view(org, { domain: "legal" }, 60);
    view(org, { domain: "finance" });
    const picks = await recommendFor(db, deps, undefined, 6, org);
    expect(picks[0]!.domain).toBe("finance");
  });

  it("combines what a team said with what it does", async () => {
    const org = buyer.buyerOrgId!;
    const prefs = setBuyerPreferences(db, deps, buyer, { domains: ["medical"] });
    view(org, { domain: "data_querying" });
    const picks = await recommendFor(db, deps, prefs, 50, org);
    const domains = new Set(picks.map((p) => p.domain));
    expect(domains.has("medical")).toBe(true);
    expect(domains.has("data_querying")).toBe(true);
    expect(picks.find((p) => p.domain === "medical")!.pickReason).toMatch(/^You said you need/);
  });
});
