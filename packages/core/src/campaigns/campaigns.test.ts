import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadConfig } from "@tm/config";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { generateCatalog, generateFlood } from "@tm/synth";
import {
  Accounts,
  balanceOf,
  campaignCriteria,
  clearCampaign,
  CampaignError,
  cancelCampaign,
  createCampaign,
  createDbEventBus,
  createMemoryBlobStore,
  creditBalance,
  ensureAccount,
  ensureWelcomeCredits,
  expireCampaigns,
  floodSupply,
  getCampaign,
  licensesHeld,
  listCampaigns,
  listNotifications,
  openCampaigns,
  repriceAll,
  resetSimulation,
  shareTrace,
  type CatalogDeps,
  type PublicUser,
  auctionListing,
  campaignFillsFor,
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
    ...generateCatalog(9, 40, NOW),
    ...generateFlood(12, 3, NOW, { domain: "medical", pattern: "user_correction" }),
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

const ledgerBalanced = () => {
  const by = new Map<string, number>();
  for (const e of db.select().from(schema.ledgerEntries).all())
    by.set(e.transactionId, (by.get(e.transactionId) ?? 0) + e.amountCents);
  return [...by.values()].every((v) => v === 0);
};

describe("campaigns", () => {
  it("reads criteria from a description", () => {
    expect(
      campaignCriteria({ describe: "medical sessions where the agent was corrected" }),
    ).toEqual({
      domain: "medical",
      failure: "user_correction",
    });
    expect(campaignCriteria({ describe: "medical", criteria: { domain: "legal" } })).toEqual({
      domain: "legal",
    });
  });

  it("escrows the budget, buys what already matches at list price, and keeps the rest in escrow", () => {
    const { campaign, filled } = createCampaign(db, deps, buyer, {
      describe: "medical corrections",
      license: "research",
      maxPriceCents: 5000,
      quantity: 10,
      days: 14,
    });
    expect(filled).toBe(3);
    const v = getCampaign(db, buyer, campaign.id)!;
    expect(v.fills).toHaveLength(3);
    expect(v.filled).toBe(3);
    expect(v.spentCents).toBe(v.fills.reduce((s, f) => s + f.priceCents, 0));
    expect(v.escrowCents).toBe(50_000 - v.spentCents);
    expect(creditBalance(db, buyer.buyerOrgId!)).toBe(0); // $500 budget = all the welcome credits
    for (const f of v.fills)
      expect(licensesHeld(db, buyer.buyerOrgId!, f.listingId)).toEqual(["research"]);
    expect(balanceOf(db, Accounts.seller(seller.id))).toBeGreaterThan(0);
    expect(ledgerBalanced()).toBe(true);
    // Sellers hear about the sale.
    expect(listNotifications(db, seller.id)[0]!.body).toContain("through the campaign");
  });

  it("keeps its counters right when a later purchase fails, so it never overbuys", () => {
    // The second fill of any campaign fails part-way.
    db.$client.exec(`CREATE TRIGGER fail_second_fill BEFORE INSERT ON campaign_fills
      WHEN (SELECT count(*) FROM campaign_fills WHERE campaign_id = NEW.campaign_id) >= 1
      BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    expect(() =>
      createCampaign(db, deps, buyer, {
        describe: "medical corrections",
        license: "research",
        maxPriceCents: 5000,
        quantity: 2,
        days: 14,
      }),
    ).toThrow(/disk full/);
    const row = db.select().from(schema.campaigns).get()!;
    // The first purchase committed, and so did its count.
    expect(row.filled).toBe(1);
    db.$client.exec("DROP TRIGGER fail_second_fill");
    clearCampaign(db, deps, row.id);
    const v = getCampaign(db, buyer, row.id)!;
    expect(v.fills).toHaveLength(2);
    expect(v.filled).toBe(2);
    expect(v.spentCents).toBe(v.fills.reduce((sum, f) => sum + f.priceCents, 0));
    expect(ledgerBalanced()).toBe(true);
  });

  it("buys new matching supply as it arrives, and stops at the quantity", async () => {
    const { campaign } = createCampaign(db, deps, buyer, {
      describe: "legal",
      license: "research",
      maxPriceCents: 3000,
      quantity: 4,
      days: 7,
    });
    const before = getCampaign(db, buyer, campaign.id)!.filled;
    const r = await floodSupply(db, deps, { domain: "legal", pattern: "clean", count: 6, seed: 5 });
    expect(r.bought).toBe(4 - before);
    const v = getCampaign(db, buyer, campaign.id)!;
    expect(v.filled).toBe(4);
    expect(v.status).toBe("filled");
    // Filled: the unspent escrow is back with the buyer.
    expect(v.escrowCents).toBe(0);
    expect(creditBalance(db, buyer.buyerOrgId!)).toBe(50_000 - v.spentCents);
    expect(ledgerBalanced()).toBe(true);
  });

  it("buys a seller's new share the moment it is listed", async () => {
    createCampaign(db, deps, buyer, {
      describe: "finance",
      license: "eval",
      maxPriceCents: 4000,
      quantity: 5,
      days: 7,
    });
    const other = await ensureAccount(db, "o@example.com", "seller", "O");
    const [t] = generateFlood(31, 1, NOW, { domain: "finance", pattern: "retry_loop" });
    const r = await shareTrace(
      db,
      deps,
      { sellerId: other.id, trace: t!, tier: 0 },
      { allowSynthetic: true },
    );
    expect(r.campaignFills).toBe(1);
    expect(listNotifications(db, other.id)[0]!.title).toMatch(/^Sold/);
  });

  it("never buys the team's own members' listings", async () => {
    const both = await ensureAccount(db, "both@example.com", "both", "Both");
    ensureWelcomeCredits(db, deps.config, both.buyerOrgId!);
    const [t] = generateFlood(41, 1, NOW, { domain: "education", pattern: "clean" });
    await shareTrace(db, deps, { sellerId: both.id, trace: t!, tier: 0 }, { allowSynthetic: true });
    const { filled } = createCampaign(db, deps, both, {
      describe: "education",
      license: "research",
      maxPriceCents: 5000,
      quantity: 5,
      days: 7,
    });
    const own = db.select().from(schema.campaignFills).all();
    expect(own.every((f) => f.listingId !== t!.id)).toBe(true);
    expect(balanceOf(db, Accounts.seller(both.id))).toBe(0);
    expect(filled).toBeGreaterThanOrEqual(0);
  });

  it("reaches a new listing behind a long event backlog, and reports only its own fills", async () => {
    createCampaign(db, deps, buyer, {
      describe: "finance",
      license: "research",
      maxPriceCents: 4000,
      quantity: 5,
      days: 7,
    });
    // A long history the consumer hasn't read: more than one batch.
    db.$client.exec("BEGIN");
    const ins = db.$client.prepare(
      "INSERT INTO events (type, payload) VALUES ('price.updated', '{}')",
    );
    for (let i = 0; i < 10_050; i++) ins.run();
    db.$client.exec("COMMIT");
    db.delete(schema.eventCursors).where(eq(schema.eventCursors.consumer, "campaigns")).run();
    const other = await ensureAccount(db, "o2@example.com", "seller", "O2");
    const [t] = generateFlood(51, 1, NOW, { domain: "finance", pattern: "tool_error" });
    const r = await shareTrace(
      db,
      deps,
      { sellerId: other.id, trace: t!, tier: 0 },
      { allowSynthetic: true },
    );
    expect(r.campaignFills).toBe(1);
    // A share in a domain no campaign wants reports none, whatever else cleared.
    const [u] = generateFlood(52, 1, NOW, { domain: "design", pattern: "clean" });
    const r2 = await shareTrace(
      db,
      deps,
      { sellerId: other.id, trace: u!, tier: 0 },
      { allowSynthetic: true },
    );
    expect(r2.campaignFills).toBeUndefined();
  });

  it("auctions a new listing: the highest bid wins and pays the second-highest", async () => {
    const lab2 = await ensureAccount(db, "lab2@example.com", "buyer", "Lab 2");
    const lab3 = await ensureAccount(db, "lab3@example.com", "buyer", "Lab 3");
    for (const b of [lab2, lab3]) ensureWelcomeCredits(db, deps.config, b.buyerOrgId!);
    const base = { describe: "finance", license: "research" as const, quantity: 2, days: 7 };
    const high = createCampaign(db, deps, buyer, { ...base, maxPriceCents: 4000 }).campaign;
    createCampaign(db, deps, lab2, { ...base, maxPriceCents: 3500 });
    createCampaign(db, deps, lab3, { ...base, maxPriceCents: 3000 });
    const before = (id: string) => getCampaign(db, buyer, id)!.filled;
    const filledBefore = before(high.id);

    const other = await ensureAccount(db, "o3@example.com", "seller", "O3");
    const [t] = generateFlood(61, 1, NOW, { domain: "finance", pattern: "user_correction" });
    const r = await shareTrace(
      db,
      deps,
      { sellerId: other.id, trace: t!, tier: 0 },
      { allowSynthetic: true },
    );
    expect(r.campaignFills).toBe(1); // one winner, not three buyers
    const v = getCampaign(db, buyer, high.id)!;
    expect(v.filled).toBe(filledBefore + 1);
    const fill = v.fills.find((f) => f.listingId === r.listingId)!;
    // Second price: the runner-up's $35, unless the list price is higher.
    expect(fill.priceCents).toBe(Math.max(3500, r.priceCents));
    expect(listNotifications(db, other.id)[0]!.body).toContain("an auction among 3 campaigns");
    // The losers hear what it went for.
    expect(listNotifications(db, lab2.id).some((n) => n.kind === "outbid")).toBe(true);
    expect(listNotifications(db, lab3.id).some((n) => n.kind === "outbid")).toBe(true);
    expect(ledgerBalanced()).toBe(true);
  });

  it("auctions a listing once, even if its event is delivered again", async () => {
    const lab2 = await ensureAccount(db, "lab2@example.com", "buyer", "Lab 2");
    ensureWelcomeCredits(db, deps.config, lab2.buyerOrgId!);
    const base = { describe: "finance", license: "research" as const, quantity: 3, days: 7 };
    createCampaign(db, deps, buyer, { ...base, maxPriceCents: 4000 });
    createCampaign(db, deps, lab2, { ...base, maxPriceCents: 3500 });
    const other = await ensureAccount(db, "o5@example.com", "seller", "O5");
    const [t] = generateFlood(62, 1, NOW, { domain: "finance", pattern: "tool_error" });
    const r = await shareTrace(
      db,
      deps,
      { sellerId: other.id, trace: t!, tier: 0 },
      { allowSynthetic: true },
    );
    expect(campaignFillsFor(db, r.listingId)).toBe(1);
    // A retry (the batch was not acknowledged): the runner-up must not buy it.
    expect(auctionListing(db, deps, r.listingId)).toBeUndefined();
    expect(campaignFillsFor(db, r.listingId)).toBe(1);
    expect(ledgerBalanced()).toBe(true);
  });

  it("tells the loser of an equal bid that it lost a tie", async () => {
    const lab2 = await ensureAccount(db, "lab2@example.com", "buyer", "Lab 2");
    ensureWelcomeCredits(db, deps.config, lab2.buyerOrgId!);
    const base = { describe: "finance", license: "research" as const, quantity: 3, days: 7 };
    createCampaign(db, deps, buyer, { ...base, maxPriceCents: 4000 });
    createCampaign(db, deps, lab2, { ...base, maxPriceCents: 4000 });
    const other = await ensureAccount(db, "o6@example.com", "seller", "O6");
    const [t] = generateFlood(63, 1, NOW, { domain: "finance", pattern: "retry_loop" });
    await shareTrace(
      db,
      deps,
      { sellerId: other.id, trace: t!, tier: 0 },
      { allowSynthetic: true },
    );
    const n = listNotifications(db, lab2.id).find((x) => x.kind === "outbid")!;
    expect(n.title).toMatch(/^Lost a tie/);
    expect(n.body).toMatch(/bid the same/);
    expect(n.body).not.toMatch(/bid more/);
  });

  it("clears at the list price with a single bidder", async () => {
    createCampaign(db, deps, buyer, {
      describe: "education",
      license: "research",
      maxPriceCents: 5000,
      quantity: 5,
      days: 7,
    });
    const other = await ensureAccount(db, "o4@example.com", "seller", "O4");
    const [t] = generateFlood(71, 1, NOW, { domain: "education", pattern: "clean" });
    const r = await shareTrace(
      db,
      deps,
      { sellerId: other.id, trace: t!, tier: 0 },
      { allowSynthetic: true },
    );
    const fill = db
      .select()
      .from(schema.campaignFills)
      .all()
      .find((f) => f.listingId === r.listingId)!;
    expect(fill.priceCents).toBeLessThan(5000);
    expect(fill.priceCents).toBeGreaterThan(0);
  });

  it("never pays above the max price", () => {
    const { filled } = createCampaign(db, deps, buyer, {
      describe: "medical",
      license: "training",
      maxPriceCents: 10,
      quantity: 5,
      days: 7,
    });
    expect(filled).toBe(0);
  });

  it("refunds escrow when cancelled or expired, once", () => {
    const a = createCampaign(db, deps, buyer, {
      describe: "legal",
      license: "research",
      maxPriceCents: 100,
      quantity: 5,
      days: 1,
    });
    cancelCampaign(db, deps, buyer, a.campaign.id);
    cancelCampaign(db, deps, buyer, a.campaign.id);
    expect(getCampaign(db, buyer, a.campaign.id)!.status).toBe("closed");
    const b = createCampaign(db, deps, buyer, {
      describe: "legal",
      license: "research",
      maxPriceCents: 100,
      quantity: 5,
      days: 1,
    });
    expect(expireCampaigns(db, { now: new Date(NOW.getTime() + 2 * 86_400_000) })).toBe(1);
    expect(getCampaign(db, buyer, b.campaign.id)!.status).toBe("expired");
    const spent = listCampaigns(db, buyer.buyerOrgId!).reduce((s, c) => s + c.spentCents, 0);
    expect(creditBalance(db, buyer.buyerOrgId!)).toBe(50_000 - spent);
    expect(openCampaigns(db)).toEqual([]);
    expect(ledgerBalanced()).toBe(true);
  });

  it("is campaign demand, which the market simulator's reset leaves alone", async () => {
    createCampaign(db, deps, buyer, {
      describe: "legal",
      license: "research",
      maxPriceCents: 100,
      quantity: 1,
      days: 7,
    });
    await resetSimulation(db, deps);
    expect(
      db.select().from(schema.demandSignals).where(eq(schema.demandSignals.kind, "campaign")).all(),
    ).toHaveLength(1);
  });

  it("refuses bad campaigns: no criteria, no credits, sellers, silly numbers", async () => {
    const base = {
      describe: "legal",
      license: "research" as const,
      maxPriceCents: 500,
      quantity: 2,
      days: 7,
    };
    expect(() => createCampaign(db, deps, buyer, { ...base, describe: "anything at all" })).toThrow(
      CampaignError,
    );
    expect(() => createCampaign(db, deps, buyer, { ...base, quantity: 0 })).toThrow(/between 1/);
    expect(() => createCampaign(db, deps, buyer, { ...base, days: 365 })).toThrow(/1 to 90/);
    expect(() =>
      createCampaign(db, deps, buyer, { ...base, maxPriceCents: 100_000, quantity: 100 }),
    ).toThrow(/escrow/);
    expect(() => createCampaign(db, deps, seller, base)).toThrow(/buyer accounts/);
    expect(db.select().from(schema.campaigns).all()).toEqual([]);
  });

  it("keeps a team's campaigns to itself", async () => {
    const other = await ensureAccount(db, "x@example.com", "buyer", "X");
    const { campaign } = createCampaign(db, deps, buyer, {
      describe: "legal",
      license: "research",
      maxPriceCents: 100,
      quantity: 1,
      days: 7,
    });
    expect(getCampaign(db, other, campaign.id)).toBeUndefined();
    expect(() => cancelCampaign(db, deps, other, campaign.id)).toThrow(/No such campaign/);
    expect(
      db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaign.id)).get()!.status,
    ).toBe("open");
  });
});
