import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadConfig } from "@tm/config";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { generateCatalog } from "@tm/synth";
import {
  Accounts,
  addDemoCredits,
  addToCart,
  balanceOf,
  buildMarket,
  cartListingIds,
  CheckoutError,
  createDbEventBus,
  createMemoryBlobStore,
  creditBalance,
  downloadable,
  ensureAccount,
  ensureWelcomeCredits,
  getQuote,
  getReceipt,
  licensesHeld,
  listOrders,
  placeOrder,
  quoteCart,
  quotePayable,
  removeFromCart,
  repriceAll,
  revokeTrace,
  sellerEarnings,
  shareTrace,
  viewCart,
  type CatalogDeps,
  type PublicUser,
} from "../index";

const NOW = new Date("2026-10-15T12:00:00Z");
let db: Db;
let deps: CatalogDeps;
let buyer: PublicUser;
let seller: PublicUser;
let listings: string[];

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
  for (const trace of generateCatalog(5, 12, NOW))
    await shareTrace(
      db,
      deps,
      { sellerId: seller.id, trace, tier: 0 },
      { allowSynthetic: true, deferMarket: true },
    );
  repriceAll(db, { ...deps, reason: "seed" });
  listings = db
    .select({ id: schema.listings.id })
    .from(schema.listings)
    .all()
    .map((r) => r.id);
  buyer = await ensureAccount(db, "lab@example.com", "buyer", "Lab");
  ensureWelcomeCredits(db, deps.config, buyer.buyerOrgId!);
});

const ledgerSums = () => {
  const txs = db.select().from(schema.ledgerEntries).all();
  const by = new Map<string, number>();
  for (const e of txs) by.set(e.transactionId, (by.get(e.transactionId) ?? 0) + e.amountCents);
  return [...by.values()];
};

describe("credits", () => {
  it("grants welcome credits once and tops up on request, always balanced", () => {
    expect(creditBalance(db, buyer.buyerOrgId!)).toBe(50_000);
    expect(ensureWelcomeCredits(db, deps.config, buyer.buyerOrgId!)).toBe(false);
    expect(addDemoCredits(db, deps.config, buyer)).toBe(75_000);
    expect(balanceOf(db, Accounts.creditIssuer)).toBe(-75_000);
    expect(ledgerSums().every((s) => s === 0)).toBe(true);
  });

  it("needs the current terms before quoting or paying", () => {
    const old = { ...buyer, termsAcceptedVersion: "2026-10-v0" };
    expect(() => quoteCart(db, deps, old, "research", [listings[0]!])).toThrow(/Accept the terms/);
    const q = quoteCart(db, deps, buyer, "research", [listings[0]!]);
    expect(() => placeOrder(db, deps, old, q.id)).toThrow(/Accept the terms/);
  });

  it("refuses sellers", () => {
    expect(() => addDemoCredits(db, deps.config, seller)).toThrow(CheckoutError);
    expect(() => addToCart(db, seller, listings[0]!)).toThrow(CheckoutError);
  });
});

describe("cart, quote and order", () => {
  it("buys a cart: balanced ledger, seller shares, licences, entitlements, receipt, demand", () => {
    addToCart(db, buyer, listings[0]!);
    addToCart(db, buyer, listings[1]!);
    addToCart(db, buyer, listings[1]!); // twice is once
    expect(cartListingIds(db, buyer.buyerOrgId!)).toEqual([listings[0], listings[1]]);
    const cart = viewCart(db, deps, buyer, "training");
    const q = quoteCart(db, deps, buyer, "training");
    expect(q.totalCents).toBe(cart.totalCents);
    // Training costs twice research (to the cent per line).
    const research = viewCart(db, deps, buyer, "research").totalCents;
    expect(Math.abs(q.totalCents - 2 * research)).toBeLessThanOrEqual(2);

    const before = creditBalance(db, buyer.buyerOrgId!);
    const r = placeOrder(db, deps, buyer, q.id);
    expect(r.lines).toBe(2);
    expect(creditBalance(db, buyer.buyerOrgId!)).toBe(before - q.totalCents);
    const sellerGot = balanceOf(db, Accounts.seller(seller.id));
    const fees = balanceOf(db, Accounts.platformFees);
    expect(sellerGot + fees).toBe(q.totalCents);
    expect(sellerGot).toBeGreaterThanOrEqual(Math.floor(q.totalCents * 0.7));
    expect(ledgerSums().every((s) => s === 0)).toBe(true);

    expect(licensesHeld(db, buyer.buyerOrgId!, listings[0]!)).toEqual(["training"]);
    expect(cartListingIds(db, buyer.buyerOrgId!)).toEqual([]);
    const receipt = getReceipt(db, buyer, r.orderId)!;
    expect(receipt.lines).toHaveLength(2);
    expect(receipt.totalCents).toBe(q.totalCents);
    expect(receipt.transactionId).toBeDefined();
    expect(listOrders(db, buyer.buyerOrgId!)).toHaveLength(1);
    expect(sellerEarnings(db, seller.id)).toMatchObject({ sales: 2, balanceCents: sellerGot });
    const purchases = db
      .select()
      .from(schema.demandSignals)
      .where(eq(schema.demandSignals.kind, "purchase"))
      .all();
    expect(purchases).toHaveLength(2);
  });

  it("holds the quoted price even if the market moves, until it expires", () => {
    const q = quoteCart(db, deps, buyer, "research", [listings[2]!]);
    db.update(schema.listings)
      .set({ currentPriceCents: 1 })
      .where(eq(schema.listings.id, listings[2]!))
      .run();
    const r = placeOrder(db, deps, buyer, q.id);
    expect(r.totalCents).toBe(q.totalCents);
    const late = quoteCart(db, deps, buyer, "eval", [listings[3]!]);
    const later = new Date(NOW.getTime() + 16 * 60_000);
    expect(() => placeOrder(db, { ...deps, now: later }, buyer, late.id)).toThrow(/expired/);
    expect(getQuote(db, buyer, late.id, later)!.expired).toBe(true);
  });

  it("never charges twice for a quote, nor for a licence already held", () => {
    const q = quoteCart(db, deps, buyer, "research", [listings[4]!]);
    placeOrder(db, deps, buyer, q.id);
    expect(() => placeOrder(db, deps, buyer, q.id)).toThrow(/already been paid/);
    expect(() => quoteCart(db, deps, buyer, "research", [listings[4]!])).toThrow(
      /Nothing in the cart/,
    );
    // A different licence on the same trace is a new purchase.
    expect(quoteCart(db, deps, buyer, "training", [listings[4]!]).totalCents).toBeGreaterThan(0);
  });

  it("skips a listing withdrawn after the quote, and refuses without enough credits", async () => {
    const q = quoteCart(db, deps, buyer, "research", [listings[5]!, listings[6]!]);
    const traceId = db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, listings[6]!))
      .get()!.traceId;
    await revokeTrace(db, deps, seller.id, traceId);
    // Checkout shows what paying will charge now, not the original total.
    const payable = quotePayable(db, buyer, getQuote(db, buyer, q.id)!);
    expect(payable.skipped).toEqual([listings[6]]);
    expect(payable.totalCents).toBe(q.lines[0]!.priceCents);
    expect(payable.totalCents).toBeLessThan(q.totalCents);
    const r = placeOrder(db, deps, buyer, q.id);
    expect(r.skipped).toEqual([listings[6]]);
    expect(r.lines).toBe(1);
    expect(r.totalCents).toBe(payable.totalCents);

    const poor = await ensureAccount(db, "poor@example.com", "buyer", "Poor");
    const q2 = quoteCart(db, deps, poor, "training", [listings[7]!]);
    expect(() => placeOrder(db, deps, poor, q2.id)).toThrow(/Not enough credits/);
    expect(listOrders(db, poor.buyerOrgId!)).toEqual([]);
    expect(ledgerSums().every((s) => s === 0)).toBe(true);
  });

  it("sells a listing only under the licences its seller offers", () => {
    const only = (id: string, allowed: string[]) =>
      db
        .update(schema.listings)
        .set({ allowedLicenses: allowed })
        .where(eq(schema.listings.id, id))
        .run();
    only(listings[2]!, ["research"]);
    const q = quoteCart(db, deps, buyer, "training", [listings[2]!, listings[3]!]);
    expect(q.lines.find((l) => l.listingId === listings[2])!.excluded).toBe("license_not_offered");
    // Offered when quoted, withdrawn from that licence before paying: skipped.
    const q2 = quoteCart(db, deps, buyer, "research", [listings[4]!]);
    only(listings[4]!, ["eval"]);
    expect(() => placeOrder(db, deps, buyer, q2.id)).toThrow(/can still be bought/);
  });

  it("reports a paid order as paid even if the follow-up work fails", () => {
    const q = quoteCart(db, deps, buyer, "research", [listings[8]!]);
    const flaky = {
      ...deps,
      bus: {
        ...deps.bus,
        emit: () => {
          throw new Error("bus down");
        },
      },
    };
    const r = placeOrder(db, flaky, buyer, q.id);
    expect(r.lines).toBe(1);
    expect(licensesHeld(db, buyer.buyerOrgId!, listings[8]!)).toContain("research");
    expect(ledgerSums().every((sum) => sum === 0)).toBe(true);
  });

  it("keeps quotes, receipts and downloads to the buying team", async () => {
    const other = await ensureAccount(db, "other@example.com", "buyer", "Other");
    const q = quoteCart(db, deps, buyer, "research", [listings[8]!]);
    expect(getQuote(db, other, q.id)).toBeUndefined();
    expect(() => placeOrder(db, deps, other, q.id)).toThrow(/doesn't exist/);
    const r = placeOrder(db, deps, buyer, q.id);
    expect(getReceipt(db, other, r.orderId)).toBeUndefined();
    expect(downloadable(db, other, listings[8]!)).toBeUndefined();
    expect(downloadable(db, buyer, listings[8]!)).toMatchObject({ scopes: ["research"] });
  });

  it("raises the price of what sold: a purchase is demand", () => {
    const market = buildMarket(db, deps);
    const row = market.active.find((a) => a.listingId === listings[9])!;
    const before = market.quote(row).priceCents;
    for (let i = 0; i < 3; i++) {
      const b = quoteCart(db, deps, buyer, (["research", "eval", "training"] as const)[i]!, [
        listings[9]!,
      ]);
      placeOrder(db, deps, buyer, b.id);
    }
    const after = buildMarket(db, deps);
    expect(
      after.quote(after.active.find((a) => a.listingId === listings[9])!).priceCents,
    ).toBeGreaterThan(before);
  });

  it("never lets a team buy its own members' listings", async () => {
    // A seller who also buys: both roles on one account.
    const both = await ensureAccount(db, "both@example.com", "both", "Both");
    const [t] = generateCatalog(99, 1, NOW);
    const r = await shareTrace(
      db,
      deps,
      { sellerId: both.id, trace: t!, tier: 0 },
      { allowSynthetic: true },
    );
    ensureWelcomeCredits(db, deps.config, both.buyerOrgId!);
    expect(() => addToCart(db, both, r.listingId)).toThrow(/your own trace/);
    expect(() => quoteCart(db, deps, both, "research", [r.listingId])).toThrow(
      /Nothing in the cart/,
    );
    // Someone else's listing is fine.
    expect(quoteCart(db, deps, both, "research", [listings[0]!]).totalCents).toBeGreaterThan(0);
    expect(balanceOf(db, Accounts.seller(both.id))).toBe(0);
  });

  it("lets a buyer remove from the cart", () => {
    addToCart(db, buyer, listings[10]!);
    removeFromCart(db, buyer, listings[10]!);
    expect(cartListingIds(db, buyer.buyerOrgId!)).toEqual([]);
    expect(() => quoteCart(db, deps, buyer, "research")).toThrow(/empty/);
  });
});
