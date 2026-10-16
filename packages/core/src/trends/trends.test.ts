import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@tm/config";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { generateCatalog, generateFlood } from "@tm/synth";
import {
  createCampaign,
  createDbEventBus,
  createMemoryBlobStore,
  ensureAccount,
  ensureWelcomeCredits,
  interestsOf,
  listNotifications,
  marketTrends,
  markAllRead,
  recordBuyerInterest,
  repriceAll,
  setInterest,
  shareTrace,
  unreadCount,
  type CatalogDeps,
  type PublicUser,
} from "../index";

const NOW = new Date("2026-10-15T12:00:00Z");
let db: Db;
let deps: CatalogDeps;
let buyer: PublicUser;
let seller: PublicUser;

beforeEach(async () => {
  db = openDb(":memory:");
  runMigrations(db);
  deps = {
    config: loadConfig(),
    bus: createDbEventBus(db),
    blobs: createMemoryBlobStore(),
    now: NOW,
  };
  seller = await ensureAccount(db, "s@example.com", "seller", "S");
  const traces = [
    ...generateCatalog(13, 60, NOW),
    ...generateFlood(14, 2, NOW, { domain: "medical", pattern: "user_correction" }),
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
  ensureWelcomeCredits(db, deps.config, buyer.buyerOrgId!);
});

describe("marketTrends", () => {
  it("shows every domain with supply shares that add up, balanced when nobody is asking", () => {
    const t = marketTrends(db, deps);
    expect(t.domains.map((d) => d.domain)).toContain("medical");
    expect(t.domains.reduce((s, d) => s + d.supply, 0)).toBe(t.totalSupply);
    expect(t.totalDemand).toBe(0);
    for (const d of t.domains) if (d.supply) expect(d.gap).toBeCloseTo(1, 0);
    for (const d of t.domains) if (!d.supply) expect(d.status).toBe("quiet");
    // Quiet domains go last.
    expect(t.domains.at(-1)!.status).toBe("quiet");
  });

  it("leaves sessions of unknown domain out of the totals the rows are shares of", () => {
    // Two listings the labeler couldn't place.
    for (const row of db.select().from(schema.traceTraits).limit(2).all())
      db.update(schema.traceTraits)
        .set({ data: { ...(row.data as object), domain: "unknown" } })
        .where(eq(schema.traceTraits.traceId, row.traceId))
        .run();
    const t = marketTrends(db, deps);
    expect(t.domains.reduce((s, d) => s + d.supply, 0)).toBe(t.totalSupply);
    expect(t.domains.reduce((s, d) => s + d.supplyShare, 0)).toBeCloseTo(1, 2);
  });

  it("puts what buyers ask for and few sellers supply at the top", () => {
    for (let i = 0; i < 4; i++) {
      const b = { ...buyer, buyerOrgId: `${buyer.buyerOrgId}` };
      recordBuyerInterest(db, deps, b, "search", { domain: "medical", failure: "user_correction" });
    }
    const t = marketTrends(db, deps);
    expect(t.domains[0]!.domain).toBe("medical");
    expect(t.domains[0]!.gap).toBeGreaterThan(1.5);
    expect(t.domains[0]!.direction).toBe("rising");
    const seg = t.segments.find((s) => s.key === "medical|user_correction")!;
    expect(seg.label).toBe("Medical and clinical evaluation · User corrected it");
    expect(seg.supply).toBeGreaterThanOrEqual(2);
    expect(seg.medianPriceCents).toBeGreaterThan(0);
    const coding = t.domains.find((d) => d.domain === "software_engineering")!;
    expect(coding.gap).toBeLessThan(1);
  });

  it("counts open campaigns and their best bid, and sales", () => {
    createCampaign(db, deps, buyer, {
      describe: "legal",
      license: "research",
      maxPriceCents: 4200,
      quantity: 3,
      days: 7,
    });
    const legal = marketTrends(db, deps).domains.find((d) => d.domain === "legal")!;
    expect(legal.openCampaigns + legal.sales).toBeGreaterThan(0);
    if (legal.openCampaigns) {
      expect(legal.bestBidCents).toBe(4200);
      expect(legal.bids).toEqual([4200]);
    }
    // Nothing legal listed at all and a campaign waiting: wanted, none listed.
    const productivity = marketTrends(db, deps).domains.find((d) => d.domain === "productivity")!;
    if (!productivity.supply) expect(productivity.status).toBe("quiet");
  });
});

describe("trends over time", () => {
  it("keeps sales of withdrawn listings, and segments an open campaign names", async () => {
    const { placeOrder, quoteCart, revokeTrace } = await import("../index");
    const medical = db
      .select({
        id: schema.listings.id,
        traceId: schema.listings.traceId,
        traits: schema.traceTraits.data,
      })
      .from(schema.listings)
      .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.listings.traceId))
      .all()
      .find((r) => (r.traits as { domain: string }).domain === "medical")!;
    placeOrder(db, deps, buyer, quoteCart(db, deps, buyer, "research", [medical.id]).id);
    await revokeTrace(db, deps, seller.id, medical.traceId);
    expect(marketTrends(db, deps).domains.find((d) => d.domain === "medical")!.sales).toBe(1);

    // A campaign whose demand has aged out of the window, for a segment nothing supplies.
    createCampaign(db, deps, buyer, {
      describe: "legal reward hacking",
      license: "research",
      maxPriceCents: 10,
      quantity: 2,
      days: 60,
    });
    db.update(schema.demandSignals)
      .set({ createdAt: new Date(NOW.getTime() - 30 * 86_400_000) })
      .run();
    const seg = marketTrends(db, deps).segments.find((x) => x.key === "legal|test_tampering");
    expect(seg?.openCampaigns).toBe(1);
    expect(seg?.status).toBe("unsupplied");
  });
});

describe("following domains", () => {
  it("lets a seller follow and unfollow known domains only", () => {
    setInterest(db, seller.id, "medical", true);
    setInterest(db, seller.id, "medical", true);
    setInterest(db, seller.id, "astrology", true);
    expect(interestsOf(db, seller.id)).toEqual(["medical"]);
    setInterest(db, seller.id, "medical", false);
    expect(interestsOf(db, seller.id)).toEqual([]);
  });

  it("tells followers when a campaign starts buying in their domain", async () => {
    const other = await ensureAccount(db, "o@example.com", "seller", "O");
    setInterest(db, seller.id, "education", true);
    setInterest(db, other.id, "legal", true);
    createCampaign(db, deps, buyer, {
      describe: "education",
      license: "research",
      maxPriceCents: 10, // too low to fill, so it stays open
      quantity: 5,
      days: 7,
    });
    const n = listNotifications(db, seller.id).find((x) => x.kind === "campaign")!;
    expect(n.title).toBe("A buyer wants Education and tutoring traces");
    expect(n.body).toContain("up to $0.10 each");
    expect(listNotifications(db, other.id).filter((x) => x.kind === "campaign")).toEqual([]);
    expect(unreadCount(db, seller.id)).toBeGreaterThan(0);
    markAllRead(db, seller.id);
    expect(unreadCount(db, seller.id)).toBe(0);
  });
});
