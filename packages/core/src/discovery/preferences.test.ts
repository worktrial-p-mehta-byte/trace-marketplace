import { beforeEach, describe, expect, it } from "vitest";
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
  recommendFor,
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
