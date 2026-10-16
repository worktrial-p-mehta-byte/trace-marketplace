import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { sellerShareFor, type MarketplaceConfig } from "@tm/config";
import { newId, schema, type Db } from "@tm/db";
import type { TraceTraits } from "@tm/enrich";
import { splitSale } from "@tm/pricing";
import type { LicenseScope } from "@tm/schema";
import { hasCurrentTerms, type PublicUser } from "../auth";
import { EventTypes, type EventBus } from "../events";
import { Accounts, balanceOf, postTransaction } from "../ledger";
import { notify } from "../notifications";
import { buildMarket, recordDemandSignal, runPricingConsumer } from "../pricing";

/**
 * Local-only checkout. A buyer team holds demo credits (the only simulated
 * step: money in). Buying is real everywhere else: a cart, a price quote
 * locked for a few minutes, an order whose ledger postings balance (buyer
 * pays, each seller gets their share, the platform its fee), a licence per
 * line, entitlements that unlock downloads, and a receipt.
 */
export class CheckoutError extends Error {}

export interface CheckoutDeps {
  config: MarketplaceConfig;
  bus: EventBus;
  now?: Date;
}

const LICENSES: LicenseScope[] = ["research", "eval", "training"];

function buyerOrg(user: PublicUser | undefined): string {
  if (!user?.buyerOrgId) throw new CheckoutError("Sign in with a buyer account to buy.");
  return user.buyerOrgId;
}

/** Spending needs the current terms (licences, no redistribution) accepted. */
function payingBuyerOrg(user: PublicUser | undefined): string {
  const orgId = buyerOrg(user);
  if (!hasCurrentTerms(user!)) throw new CheckoutError("Accept the terms before buying.");
  return orgId;
}

// ---------------------------------------------------------------- credits

/** The team's credit balance, in cents. */
export function creditBalance(db: Db, orgId: string): number {
  return balanceOf(db, Accounts.buyer(orgId));
}

/** Give a buyer team its welcome credits, once. Returns whether it granted any. */
export function ensureWelcomeCredits(db: Db, config: MarketplaceConfig, orgId: string): boolean {
  const cents = config.checkout.welcomeCreditCents;
  if (cents <= 0) return false;
  const done = db
    .select({ id: schema.ledgerTransactions.id })
    .from(schema.ledgerTransactions)
    .where(
      and(
        eq(schema.ledgerTransactions.kind, "credit_grant"),
        eq(schema.ledgerTransactions.refType, "welcome"),
        eq(schema.ledgerTransactions.refId, orgId),
      ),
    )
    .get();
  if (done) return false;
  postTransaction(db, {
    kind: "credit_grant",
    refType: "welcome",
    refId: orgId,
    lines: [
      { account: Accounts.creditIssuer, amountCents: -cents },
      { account: Accounts.buyer(orgId), amountCents: cents },
    ],
  });
  return true;
}

/** Simulated money in: add demo credits to a buyer team. */
export function addDemoCredits(db: Db, config: MarketplaceConfig, user: PublicUser): number {
  const orgId = buyerOrg(user);
  const cents = config.checkout.topUpCents;
  postTransaction(db, {
    kind: "credit_grant",
    refType: "top_up",
    refId: orgId,
    lines: [
      { account: Accounts.creditIssuer, amountCents: -cents },
      { account: Accounts.buyer(orgId), amountCents: cents },
    ],
  });
  return creditBalance(db, orgId);
}

// ---------------------------------------------------------------- entitlements

/** Licence scopes a team holds on a listing. */
export function licensesHeld(db: Db, orgId: string, listingId: string): LicenseScope[] {
  const rows = db
    .select({ scope: schema.licenses.scope })
    .from(schema.entitlements)
    .innerJoin(schema.licenses, eq(schema.licenses.id, schema.entitlements.licenseId))
    .innerJoin(schema.orderLines, eq(schema.orderLines.id, schema.licenses.orderLineId))
    .where(
      and(
        eq(schema.entitlements.buyerOrgId, orgId),
        eq(schema.orderLines.listingId, listingId),
        isNull(schema.entitlements.revokedAt),
      ),
    )
    .all();
  return [...new Set(rows.map((r) => r.scope))];
}

// ---------------------------------------------------------------- cart

function cartId(db: Db, orgId: string, create: boolean): string | undefined {
  const row = db
    .select({ id: schema.collections.id })
    .from(schema.collections)
    .where(
      and(
        eq(schema.collections.buyerOrgId, orgId),
        eq(schema.collections.kind, "static"),
        eq(schema.collections.name, "Cart"),
      ),
    )
    .get();
  if (row || !create) return row?.id;
  const id = newId("col");
  db.insert(schema.collections)
    .values({ id, buyerOrgId: orgId, name: "Cart", kind: "static" })
    .run();
  return id;
}

export function addToCart(db: Db, user: PublicUser, listingId: string): void {
  const orgId = buyerOrg(user);
  const listing = db.select().from(schema.listings).where(eq(schema.listings.id, listingId)).get();
  if (!listing || listing.status !== "active")
    throw new CheckoutError("That trace is not for sale.");
  const seller = sellerOf(db, listingId);
  if (seller && orgMemberIds(db, orgId).has(seller))
    throw new CheckoutError("You can't buy your own trace.");
  const id = cartId(db, orgId, true)!;
  db.insert(schema.collectionItems)
    .values({ collectionId: id, listingId })
    .onConflictDoNothing()
    .run();
}

export function removeFromCart(db: Db, user: PublicUser, listingId: string): void {
  const id = cartId(db, buyerOrg(user), false);
  if (!id) return;
  db.delete(schema.collectionItems)
    .where(
      and(
        eq(schema.collectionItems.collectionId, id),
        eq(schema.collectionItems.listingId, listingId),
      ),
    )
    .run();
}

export function cartListingIds(db: Db, orgId: string): string[] {
  const id = cartId(db, orgId, false);
  if (!id) return [];
  return db
    .select({ listingId: schema.collectionItems.listingId })
    .from(schema.collectionItems)
    .where(eq(schema.collectionItems.collectionId, id))
    .orderBy(schema.collectionItems.addedAt)
    .all()
    .map((r) => r.listingId);
}

export interface PricedLine {
  listingId: string;
  title: string | null;
  priceCents: number;
  /** Why the line is left out of the order, if it is. */
  excluded?: "not_for_sale" | "already_licensed" | "own_listing" | "license_not_offered";
}

/**
 * The users behind a buyer team. A team never buys its own members' listings:
 * that would pay their own seller account and fake sales and demand.
 */
export function orgMemberIds(db: Pick<Db, "select">, orgId: string): Set<string> {
  return new Set(
    db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.buyerOrgId, orgId))
      .all()
      .map((r) => r.id),
  );
}

function sellerOf(db: Db, listingId: string): string | undefined {
  return db
    .select({ sellerId: schema.traces.sellerId })
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.listings.id, listingId))
    .get()?.sellerId;
}

/** Price listings under a licence as the market stands now. */
function priceLines(
  db: Db,
  deps: CheckoutDeps,
  orgId: string,
  listingIds: string[],
  license: LicenseScope,
): PricedLine[] {
  if (!listingIds.length) return [];
  const market = buildMarket(db, { config: deps.config, now: deps.now });
  const byId = new Map(market.active.map((a) => [a.listingId, a]));
  const info = new Map(
    db
      .select({
        id: schema.listings.id,
        title: schema.traces.title,
        allowed: schema.listings.allowedLicenses,
      })
      .from(schema.listings)
      .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
      .where(inArray(schema.listings.id, listingIds))
      .all()
      .map((r) => [r.id, r]),
  );
  const members = orgMemberIds(db, orgId);
  return listingIds.map((listingId) => {
    const row = byId.get(listingId);
    const title = info.get(listingId)?.title ?? null;
    if (!row) return { listingId, title, priceCents: 0, excluded: "not_for_sale" as const };
    if (!info.get(listingId)!.allowed.includes(license))
      return { listingId, title, priceCents: 0, excluded: "license_not_offered" as const };
    if (members.has(row.sellerId))
      return { listingId, title, priceCents: 0, excluded: "own_listing" as const };
    if (licensesHeld(db, orgId, listingId).includes(license))
      return { listingId, title, priceCents: 0, excluded: "already_licensed" as const };
    return { listingId, title, priceCents: market.quote(row, license).priceCents };
  });
}

export function viewCart(db: Db, deps: CheckoutDeps, user: PublicUser, license: LicenseScope) {
  const orgId = buyerOrg(user);
  const lines = priceLines(db, deps, orgId, cartListingIds(db, orgId), license);
  return {
    lines,
    totalCents: lines.filter((l) => !l.excluded).reduce((s, l) => s + l.priceCents, 0),
    balanceCents: creditBalance(db, orgId),
  };
}

// ---------------------------------------------------------------- quotes and orders

export interface QuoteView {
  id: string;
  license: LicenseScope;
  lines: PricedLine[];
  totalCents: number;
  expiresAt: Date;
  expired: boolean;
  orderId?: string;
}

/**
 * Lock the cart's prices under one licence for `pricing.quoteLockMinutes`.
 * The listings are snapshotted, so the order buys exactly what was quoted.
 */
export function quoteCart(
  db: Db,
  deps: CheckoutDeps,
  user: PublicUser,
  license: LicenseScope,
  listingIds?: string[],
): QuoteView {
  const orgId = payingBuyerOrg(user);
  if (!LICENSES.includes(license)) throw new CheckoutError("Choose a licence.");
  const ids = listingIds ?? cartListingIds(db, orgId);
  if (!ids.length) throw new CheckoutError("Your cart is empty.");
  if (ids.length > deps.config.checkout.maxOrderLines)
    throw new CheckoutError(`At most ${deps.config.checkout.maxOrderLines} traces per order.`);
  const lines = priceLines(db, deps, orgId, ids, license);
  const buyable = lines.filter((l) => !l.excluded);
  if (!buyable.length)
    throw new CheckoutError("Nothing in the cart can be bought under this licence.");
  const now = deps.now ?? new Date();
  const total = buyable.reduce((s, l) => s + l.priceCents, 0);
  const expiresAt = new Date(now.getTime() + deps.config.pricing.quoteLockMinutes * 60_000);
  const collectionId = cartId(db, orgId, true)!;
  const snapshotId = newId("csn");
  const quoteId = newId("quo");
  db.transaction((tx) => {
    tx.insert(schema.collectionSnapshots)
      .values({
        id: snapshotId,
        collectionId,
        version: now.getTime(),
        listingIds: buyable.map((l) => l.listingId),
        createdAt: now,
      })
      .run();
    tx.insert(schema.quotes)
      .values({
        id: quoteId,
        buyerOrgId: orgId,
        snapshotId,
        license,
        totalCents: total,
        breakdown: lines,
        expiresAt,
        createdAt: now,
      })
      .run();
  });
  return { id: quoteId, license, lines, totalCents: total, expiresAt, expired: false };
}

export function getQuote(
  db: Db,
  user: PublicUser,
  quoteId: string,
  now = new Date(),
): QuoteView | undefined {
  const orgId = buyerOrg(user);
  const q = db
    .select()
    .from(schema.quotes)
    .where(and(eq(schema.quotes.id, quoteId), eq(schema.quotes.buyerOrgId, orgId)))
    .get();
  if (!q) return undefined;
  const order = db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(eq(schema.orders.quoteId, q.id))
    .get();
  return {
    id: q.id,
    license: q.license,
    lines: q.breakdown as PricedLine[],
    totalCents: q.totalCents,
    expiresAt: q.expiresAt,
    expired: q.expiresAt.getTime() < now.getTime(),
    orderId: order?.id,
  };
}

export interface OrderResult {
  orderId: string;
  totalCents: number;
  lines: number;
  /** Quoted lines left out because they stopped being for sale. */
  skipped: string[];
}

/**
 * Pay for a quote with credits. One database transaction: the order and its
 * lines, a licence and an entitlement per line, and one balanced ledger
 * posting (buyer −total; each seller +share; platform +fee). Then each line
 * counts as purchase demand and prices are recomputed.
 */
/** What a sale needs to know about each listing. */
export interface SaleRow {
  listingId: string;
  status: "active" | "delisted";
  assetId: string;
  sellerId: string;
  title: string | null;
  traits: TraceTraits;
  /** The licences the seller offers this listing under. */
  allowedLicenses: string[];
}

export function loadSaleRows(db: Db, listingIds: string[]): Map<string, SaleRow> {
  if (!listingIds.length) return new Map();
  const rows = db
    .select({
      listingId: schema.listings.id,
      status: schema.listings.status,
      assetId: schema.listings.assetId,
      sellerId: schema.traces.sellerId,
      title: schema.traces.title,
      traits: schema.traceTraits.data,
      allowedLicenses: schema.listings.allowedLicenses,
    })
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.traces.id))
    .where(inArray(schema.listings.id, listingIds))
    .all();
  return new Map(rows.map((r) => [r.listingId, { ...r, traits: r.traits as TraceTraits }]));
}

/**
 * Write a paid order inside an open transaction: the order, a line, licence
 * and entitlement per listing, and one balanced sale posting from
 * `fundingAccount` (the buyer's credits, or a campaign's escrow) to each
 * seller and the platform. Sellers are notified of the sale.
 */
export function writeOrderTx(
  tx: Pick<Db, "insert" | "transaction">,
  deps: { config: MarketplaceConfig },
  o: {
    orgId: string;
    quoteId: string;
    license: LicenseScope;
    lines: { listingId: string; priceCents: number }[];
    rows: Map<string, SaleRow>;
    fundingAccount: string;
    now: Date;
    /** How the sale is described to sellers, e.g. "a campaign". */
    via?: string;
  },
): string {
  const orderId = newId("ord");
  const total = o.lines.reduce((s, l) => s + l.priceCents, 0);
  tx.insert(schema.orders)
    .values({
      id: orderId,
      quoteId: o.quoteId,
      buyerOrgId: o.orgId,
      status: "paid",
      totalCents: total,
      createdAt: o.now,
    })
    .run();
  const ledger: { account: string; amountCents: number }[] = [
    { account: o.fundingAccount, amountCents: -total },
  ];
  let platform = 0;
  for (const l of o.lines) {
    const row = o.rows.get(l.listingId)!;
    const share = sellerShareFor(deps.config, row.traits.domain);
    const split = splitSale(l.priceCents, share);
    const lineId = newId("oln");
    tx.insert(schema.orderLines)
      .values({
        id: lineId,
        orderId,
        listingId: l.listingId,
        priceCents: l.priceCents,
        sellerShareRate: share,
        createdAt: o.now,
      })
      .run();
    const licenseId = newId("lic");
    tx.insert(schema.licenses)
      .values({
        id: licenseId,
        orderLineId: lineId,
        scope: o.license,
        exclusive: false,
        startsAt: o.now,
      })
      .run();
    tx.insert(schema.entitlements)
      .values({
        id: newId("ent"),
        buyerOrgId: o.orgId,
        assetId: row.assetId,
        licenseId,
        grantedAt: o.now,
      })
      .run();
    ledger.push({ account: Accounts.seller(row.sellerId), amountCents: split.seller });
    platform += split.platform;
    notify(tx, row.sellerId, {
      kind: "sale",
      title: `Sold: ${row.title ?? "a signals-only session"}`,
      body: `A buyer licensed it for ${o.license}${o.via ? ` through ${o.via}` : ""}. You earned $${(split.seller / 100).toFixed(2)}.`,
      href: `/traces/${l.listingId}`,
      now: o.now,
    });
  }
  ledger.push({ account: Accounts.platformFees, amountCents: platform });
  postTransaction(tx, { kind: "sale", refType: "order", refId: orderId, lines: ledger });
  return orderId;
}

/** Each bought trace is purchase demand for its domain and failure; then reprice. */
export function recordPurchases(
  db: Db,
  deps: CheckoutDeps,
  orgId: string,
  traits: TraceTraits[],
  now: Date,
): void {
  for (const t of traits) {
    recordDemandSignal(db, deps.bus, {
      kind: "purchase",
      criteria: {
        domain: t.domain && t.domain !== "unknown" ? t.domain : undefined,
        failure: t.failureCategory,
      },
      weight: deps.config.pricing.demand.signalWeights.purchase,
      buyerOrgId: orgId,
      now,
    });
  }
  runPricingConsumer(db, deps.bus, { config: deps.config, now });
}

/**
 * The quoted lines that can still be bought right now (still listed, still
 * offered under the quote's licence, not the team's own, not already held),
 * at their quoted prices. Checkout shows this total; payment charges it.
 */
function payableLines(db: Db, orgId: string, quote: QuoteView) {
  const wanted = quote.lines.filter((l) => !l.excluded);
  const byId = loadSaleRows(
    db,
    wanted.map((l) => l.listingId),
  );
  const members = orgMemberIds(db, orgId);
  const lines = wanted.filter((l) => {
    const row = byId.get(l.listingId);
    return (
      row?.status === "active" &&
      row.allowedLicenses.includes(quote.license) &&
      !members.has(row.sellerId) &&
      !licensesHeld(db, orgId, l.listingId).includes(quote.license)
    );
  });
  const skipped = wanted.filter((l) => !lines.includes(l)).map((l) => l.listingId);
  return { lines, skipped, byId };
}

/** What paying this quote would charge now, and the lines it would skip. */
export function quotePayable(
  db: Db,
  user: PublicUser,
  quote: QuoteView,
): { totalCents: number; lineCount: number; skipped: string[] } {
  const { lines, skipped } = payableLines(db, buyerOrg(user), quote);
  return {
    totalCents: lines.reduce((sum, l) => sum + l.priceCents, 0),
    lineCount: lines.length,
    skipped,
  };
}

export function placeOrder(
  db: Db,
  deps: CheckoutDeps,
  user: PublicUser,
  quoteId: string,
): OrderResult {
  const orgId = payingBuyerOrg(user);
  const now = deps.now ?? new Date();
  const quote = getQuote(db, user, quoteId, now);
  if (!quote) throw new CheckoutError("That quote doesn't exist.");
  if (quote.orderId) throw new CheckoutError("This quote has already been paid.");
  if (quote.expired)
    throw new CheckoutError("The quote expired. Review the cart again for current prices.");

  const { lines, skipped, byId } = payableLines(db, orgId, quote);
  if (!lines.length) throw new CheckoutError("None of the quoted traces can still be bought.");
  const total = lines.reduce((sum, l) => sum + l.priceCents, 0);
  const balance = creditBalance(db, orgId);
  if (balance < total) {
    throw new CheckoutError(
      `Not enough credits: the order is $${(total / 100).toFixed(2)} and the balance is $${(balance / 100).toFixed(2)}.`,
    );
  }

  let orderId = "";
  db.transaction((tx) => {
    // Re-check inside the transaction: two tabs paying the same quote.
    if (
      tx
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(eq(schema.orders.quoteId, quoteId))
        .get()
    )
      throw new CheckoutError("This quote has already been paid.");
    orderId = writeOrderTx(tx, deps, {
      orgId,
      quoteId,
      license: quote.license,
      lines,
      rows: byId,
      fundingAccount: Accounts.buyer(orgId),
      now,
    });
    // Bought traces leave the cart.
    const cart = cartId(tx as unknown as Db, orgId, false);
    if (cart) {
      tx.delete(schema.collectionItems)
        .where(
          and(
            eq(schema.collectionItems.collectionId, cart),
            inArray(
              schema.collectionItems.listingId,
              lines.map((l) => l.listingId),
            ),
          ),
        )
        .run();
    }
  });

  // The order is paid and committed. What follows must not turn a
  // successful payment into an error for the buyer, and each step runs on
  // its own, so a failed event never costs the purchase its demand signal.
  try {
    deps.bus.emit(EventTypes.OrderPaid, { orderId, lines: lines.length, totalCents: total });
  } catch (err) {
    console.error(`[checkout] order ${orderId} is paid; its event failed`, err);
  }
  try {
    recordPurchases(
      db,
      deps,
      orgId,
      lines.map((l) => byId.get(l.listingId)!.traits),
      now,
    );
  } catch (err) {
    console.error(`[checkout] order ${orderId} is paid; recording its demand failed`, err);
  }
  return { orderId, totalCents: total, lines: lines.length, skipped };
}

// ---------------------------------------------------------------- receipts

export interface ReceiptLine {
  listingId: string;
  title: string | null;
  priceCents: number;
  license: LicenseScope;
}

export interface Receipt {
  orderId: string;
  createdAt: Date;
  status: "pending" | "paid" | "refunded";
  totalCents: number;
  license: LicenseScope;
  lines: ReceiptLine[];
  /** The ledger posting behind the order. */
  transactionId?: string;
}

export function listOrders(db: Db, orgId: string) {
  return db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.buyerOrgId, orgId))
    .orderBy(desc(schema.orders.createdAt))
    .all()
    .map((o) => ({
      ...o,
      lines: db
        .select({ id: schema.orderLines.id })
        .from(schema.orderLines)
        .where(eq(schema.orderLines.orderId, o.id))
        .all().length,
    }));
}

export function getReceipt(db: Db, user: PublicUser, orderId: string): Receipt | undefined {
  const orgId = buyerOrg(user);
  const o = db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.buyerOrgId, orgId)))
    .get();
  if (!o) return undefined;
  const lines = db
    .select({
      listingId: schema.orderLines.listingId,
      priceCents: schema.orderLines.priceCents,
      title: schema.traces.title,
      license: schema.licenses.scope,
    })
    .from(schema.orderLines)
    .innerJoin(schema.licenses, eq(schema.licenses.orderLineId, schema.orderLines.id))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.orderLines.listingId))
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.orderLines.orderId, o.id))
    .all();
  const tx = db
    .select({ id: schema.ledgerTransactions.id })
    .from(schema.ledgerTransactions)
    .where(
      and(
        eq(schema.ledgerTransactions.refType, "order"),
        eq(schema.ledgerTransactions.refId, o.id),
      ),
    )
    .get();
  return {
    orderId: o.id,
    createdAt: o.createdAt,
    status: o.status,
    totalCents: o.totalCents,
    license: lines[0]?.license ?? "research",
    lines,
    transactionId: tx?.id,
  };
}

/** What a seller has earned from sales, and how many licences they've sold. */
export function sellerEarnings(db: Db, sellerId: string) {
  const sales = db
    .select({ listingId: schema.orderLines.listingId })
    .from(schema.orderLines)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.orderLines.listingId))
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.traces.sellerId, sellerId))
    .all();
  const perListing = new Map<string, number>();
  for (const s of sales) perListing.set(s.listingId, (perListing.get(s.listingId) ?? 0) + 1);
  return {
    balanceCents: balanceOf(db, Accounts.seller(sellerId)),
    sales: sales.length,
    perListing,
  };
}

/**
 * The licensed content for a download: the stored trace (scrubbed, or
 * signals only) and the licence it is held under. Undefined without an
 * entitlement.
 */
export function downloadable(db: Db, user: PublicUser | undefined, listingId: string) {
  if (!user?.buyerOrgId) return undefined;
  const scopes = licensesHeld(db, user.buyerOrgId, listingId);
  if (!scopes.length) return undefined;
  const row = db
    .select({
      blobKey: schema.traces.blobKey,
      tier: schema.listings.tier,
      title: schema.traces.title,
    })
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.listings.id, listingId))
    .get();
  if (!row) return undefined;
  return { ...row, scopes };
}
