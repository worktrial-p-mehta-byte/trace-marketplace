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
  floodSupply,
  openBounties,
  postBounty,
  repriceAll,
  resetSimulation,
  shareTrace,
  ShareError,
  SIMULATOR_SELLER_EMAIL,
  watchList,
  type CatalogDeps,
} from "../index";

const NOW = new Date("2026-10-15T12:00:00Z");
let db: Db;
let deps: CatalogDeps;
let buyerOrgId: string;

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
  const seller = await ensureAccount(db, "seed@example.com", "seller", "Seed seller");
  // A small market: 40 random sessions plus two rare Rust/Tokio retry loops.
  const traces = [
    ...generateCatalog(11, 40, NOW),
    ...generateFlood(5, 2, NOW, { language: "Rust", framework: "Tokio", pattern: "retry_loop" }),
  ];
  for (const trace of traces) {
    await shareTrace(
      db,
      deps,
      { sellerId: seller.id, trace, tier: 0 },
      { allowSynthetic: true, deferMarket: true },
    );
  }
  repriceAll(db, { ...deps, reason: "seed" });
  buyerOrgId = (await ensureAccount(db, "lab@example.com", "buyer", "Lab")).buyerOrgId!;
});

const rust = { language: "Rust", framework: "Tokio", failure: "retry_loop" };

describe("internal ingest", () => {
  it("accepts synthetic traces only for internal callers", async () => {
    const seller = await ensureAccount(db, "x@example.com", "seller", "X");
    const [t] = generateFlood(77, 1, NOW, { language: "Go", pattern: "tool_error" });
    await expect(shareTrace(db, deps, { sellerId: seller.id, trace: t, tier: 0 })).rejects.toThrow(
      ShareError,
    );
    await expect(
      shareTrace(db, deps, { sellerId: seller.id, trace: t, tier: 0 }, { allowSynthetic: true }),
    ).resolves.toBeDefined();
  });

  it("ensureAccount is idempotent and accepts the terms", async () => {
    const a = await ensureAccount(db, "seed@example.com", "seller", "Seed seller");
    const b = await ensureAccount(db, "seed@example.com", "seller", "Seed seller");
    expect(a.id).toBe(b.id);
    expect(a.termsAcceptedVersion).toBe("2026-10-v0");
  });
});

describe("postBounty", () => {
  it("raises the prices of matching listings only, and records the bounty", () => {
    const others = watchList(db, deps.config, { language: "TypeScript" }, 50);
    const r = postBounty(db, deps, {
      buyerOrgId,
      title: "Rust async retry loops",
      criteria: rust,
      perTraceCents: 2000,
      quantity: 10,
      now: NOW,
    });
    expect(r.weight).toBeCloseTo(4); // $200 × 0.02
    expect(r.moves).toHaveLength(2);
    for (const m of r.moves) expect(m.after).toBeGreaterThan(m.before);
    for (const o of others) {
      const now = db
        .select()
        .from(schema.listings)
        .where(eq(schema.listings.id, o.listingId))
        .get()!;
      expect(now.currentPriceCents).toBe(o.priceCents);
    }
    expect(openBounties(db)).toHaveLength(1);
  });
});

describe("floodSupply", () => {
  it("adds simulator-owned supply and lowers the matching prices", async () => {
    const r = await floodSupply(db, deps, {
      language: "Rust",
      framework: "Tokio",
      pattern: "retry_loop",
      count: 20,
      seed: 3,
    });
    expect(r.added).toBe(20);
    const originals = r.moves.filter((m) => m.before > 0);
    expect(originals.length).toBeGreaterThanOrEqual(2);
    for (const m of originals) expect(m.after).toBeLessThan(m.before);
    // The new supply is searchable straight away.
    expect((await deps.search!.search({ text: "retry" })).ids.length).toBeGreaterThan(0);
  });
});

describe("resetSimulation", () => {
  it("closes bounties, drops bounty demand and withdraws only simulator supply", async () => {
    const start = watchList(db, deps.config, rust).map((w) => w.priceCents);
    postBounty(db, deps, {
      buyerOrgId,
      title: "b",
      criteria: rust,
      perTraceCents: 2000,
      quantity: 10,
      now: NOW,
    });
    await floodSupply(db, deps, {
      language: "Rust",
      framework: "Tokio",
      pattern: "retry_loop",
      count: 10,
      seed: 4,
    });
    const r = await resetSimulation(db, deps);
    expect(r.withdrawn).toBe(10);
    expect(openBounties(db)).toEqual([]);
    expect(
      db.select().from(schema.demandSignals).where(eq(schema.demandSignals.kind, "bounty")).all(),
    ).toEqual([]);
    const sim = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, SIMULATOR_SELLER_EMAIL))
      .get()!;
    const live = db
      .select()
      .from(schema.listings)
      .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
      .where(eq(schema.traces.sellerId, sim.id))
      .all()
      .filter((r) => r.listings.status === "active");
    expect(live).toEqual([]);
    // Prices are back where they started.
    expect(watchList(db, deps.config, rust).map((w) => w.priceCents)).toEqual(start);
  });
});

describe("watchList", () => {
  it("follows the most expensive matches, with price history", () => {
    postBounty(db, deps, {
      buyerOrgId,
      title: "b",
      criteria: rust,
      perTraceCents: 1000,
      quantity: 5,
      now: NOW,
    });
    const w = watchList(db, deps.config, rust);
    expect(w).toHaveLength(2);
    expect(w[0]!.history.length).toBeGreaterThanOrEqual(2);
    expect(w[0]!.priceCents).toBeGreaterThanOrEqual(w[1]!.priceCents);
  });

  it("keeps following the same listings after the simulator adds supply", async () => {
    const before = watchList(db, deps.config, rust).map((w) => w.listingId);
    await floodSupply(db, deps, {
      language: "Rust",
      framework: "Tokio",
      pattern: "retry_loop",
      count: 10,
      seed: 9,
    });
    expect(
      watchList(db, deps.config, rust)
        .map((w) => w.listingId)
        .sort(),
    ).toEqual([...before].sort());
  });
});
