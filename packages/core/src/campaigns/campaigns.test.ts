import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadConfig } from "@tm/config";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { generateCatalog, generateFlood } from "@tm/synth";
import {
  Accounts,
  balanceOf,
  campaignCriteria,
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
