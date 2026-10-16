import { and, asc, desc, eq, lte } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { newId, schema, type Db } from "@tm/db";
import { isEmptyCriteria, matchesCriteria, type DemandCriteria } from "@tm/pricing";
import type { LicenseScope } from "@tm/schema";
import { hasCurrentTerms, type PublicUser } from "../auth";
import {
  creditBalance,
  licensesHeld,
  loadSaleRows,
  orgMemberIds,
  recordPurchases,
  writeOrderTx,
} from "../checkout";
import { resolveQuery } from "../catalog/browse";
import { EventTypes, type EventBus } from "../events";
import { Accounts, balanceOf, postTransaction } from "../ledger";
import { buildMarket, recordDemandSignal, runPricingConsumer } from "../pricing";
import { notify } from "../notifications";
import { notifyCampaignFollowers } from "../trends";

/**
 * Campaigns: a buyer's standing bid. "Up to 50 medical traces where the
 * agent was corrected, at most $15 each, for the next 14 days." The budget
 * (max price × quantity) moves into escrow; every matching listing at or
 * under the max price is bought automatically at its list price (a
 * one-bidder auction clears at the reserve), now and as new supply
 * arrives, until the quantity or budget runs out or the campaign expires.
 * What is left in escrow then goes back to the buyer. Multi-bidder clearing
 * and exclusivity come after the demo.
 */
export class CampaignError extends Error {}

export interface CampaignDeps {
  config: MarketplaceConfig;
  bus: EventBus;
  now?: Date;
}

export interface CampaignInput {
  title?: string;
  /** What the buyer wants, in words; read by the intent parser into criteria. */
  describe?: string;
  criteria?: DemandCriteria;
  license: LicenseScope;
  maxPriceCents: number;
  quantity: number;
  days: number;
}

export type CampaignRow = typeof schema.campaigns.$inferSelect;

export interface CampaignView extends CampaignRow {
  criteria: DemandCriteria;
  escrowCents: number;
  fills: { listingId: string; title: string | null; priceCents: number; createdAt: Date }[];
}

const MAX_QUANTITY = 500;
const MAX_DAYS = 90;

function orgOf(user: PublicUser | undefined): string {
  if (!user?.buyerOrgId) throw new CampaignError("Campaigns are for buyer accounts.");
  return user.buyerOrgId;
}

/** Criteria from a description and explicit fields (explicit wins). */
export function campaignCriteria(
  input: Pick<CampaignInput, "describe" | "criteria">,
): DemandCriteria {
  const fromText = input.describe ? resolveQuery({ text: input.describe }).query : {};
  const c: DemandCriteria = {
    domain: fromText.domain,
    language: fromText.language,
    framework: fromText.framework,
    failure: fromText.failure,
    ...Object.fromEntries(Object.entries(input.criteria ?? {}).filter(([, v]) => v)),
  };
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v)) as DemandCriteria;
}

function describeCriteria(c: DemandCriteria): string {
  return (
    [c.domain?.replace(/_/g, " "), c.language, c.framework, c.failure?.replace(/_/g, " "), c.model]
      .filter(Boolean)
      .join(" · ") || "any trace"
  );
}

export function createCampaign(
  db: Db,
  deps: CampaignDeps,
  user: PublicUser,
  input: CampaignInput,
): { campaign: CampaignRow; filled: number } {
  const orgId = orgOf(user);
  if (!hasCurrentTerms(user))
    throw new CampaignError("Accept the terms before starting a campaign.");
  const criteria = campaignCriteria(input);
  if (isEmptyCriteria(criteria))
    throw new CampaignError("Say what the campaign should buy: a domain, failure, language…");
  const quantity = Math.round(input.quantity);
  const maxPriceCents = Math.round(input.maxPriceCents);
  const days = Math.round(input.days);
  if (!(quantity >= 1 && quantity <= MAX_QUANTITY))
    throw new CampaignError(`Buy between 1 and ${MAX_QUANTITY} traces.`);
  if (!(maxPriceCents >= 10)) throw new CampaignError("Set a maximum price of at least $0.10.");
  if (!(days >= 1 && days <= MAX_DAYS)) throw new CampaignError(`Run for 1 to ${MAX_DAYS} days.`);
  if (!["research", "eval", "training"].includes(input.license))
    throw new CampaignError("Choose a licence.");
  const budget = maxPriceCents * quantity;
  const balance = creditBalance(db, orgId);
  if (balance < budget) {
    throw new CampaignError(
      `The campaign needs $${(budget / 100).toFixed(2)} in escrow and the balance is $${(balance / 100).toFixed(2)}.`,
    );
  }
  const now = deps.now ?? new Date();
  const id = newId("cmp");
  const collectionId = newId("col");
  const title = (input.title?.trim() || describeCriteria(criteria)).slice(0, 120);
  db.transaction((tx) => {
    tx.insert(schema.collections)
      .values({
        id: collectionId,
        buyerOrgId: orgId,
        name: `Campaign: ${title}`,
        kind: "static",
        createdAt: now,
      })
      .run();
    tx.insert(schema.campaigns)
      .values({
        id,
        buyerOrgId: orgId,
        title,
        criteria,
        license: input.license,
        maxPriceCents,
        quantity,
        budgetCents: budget,
        status: "open",
        collectionId,
        expiresAt: new Date(now.getTime() + days * 86_400_000),
        createdAt: now,
      })
      .run();
    postTransaction(tx, {
      kind: "campaign_escrow",
      refType: "campaign",
      refId: id,
      lines: [
        { account: Accounts.buyer(orgId), amountCents: -budget },
        { account: Accounts.escrow(id), amountCents: budget },
      ],
    });
  });
  // A campaign is the strongest statement of demand there is short of buying.
  recordDemandSignal(db, deps.bus, {
    kind: "campaign",
    criteria,
    weight: (budget / 100) * deps.config.pricing.demand.bountyWeightPerDollar,
    buyerOrgId: orgId,
    now,
  });
  deps.bus.emit(EventTypes.BountyPosted, { campaignId: id });
  runPricingConsumer(db, deps.bus, { config: deps.config, now });
  const filled = clearCampaign(db, deps, id);
  const campaign = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get()!;
  // Sellers who follow the domain hear that a buyer is standing ready.
  if (campaign.status === "open") {
    notifyCampaignFollowers(
      db,
      { ...campaign, criteria: campaign.criteria as DemandCriteria },
      now,
    );
  }
  return { campaign, filled };
}

/**
 * Buy what a campaign can: active listings that match, priced under its
 * licence at or under its max price, not already licensed by the team,
 * cheapest first, within its remaining quantity and escrow. Returns how many
 * it bought.
 */
export function clearCampaign(
  db: Db,
  deps: CampaignDeps,
  campaignId: string,
  only?: string[],
  /** Auction: pay this instead of the list price (never less than list, never above the bid). */
  clearing?: { priceCents: number; via: string },
): number {
  const now = deps.now ?? new Date();
  const c = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).get();
  if (!c || c.status !== "open") return 0;
  if (c.expiresAt.getTime() <= now.getTime()) {
    closeCampaign(db, deps, c.id, "expired");
    return 0;
  }
  const criteria = c.criteria as DemandCriteria;
  const market = buildMarket(db, { config: deps.config, now });
  const already = new Set(
    db
      .select({ listingId: schema.campaignFills.listingId })
      .from(schema.campaignFills)
      .where(eq(schema.campaignFills.campaignId, c.id))
      .all()
      .map((r) => r.listingId),
  );
  const members = orgMemberIds(db, c.buyerOrgId);
  // Only listings the seller offers under the campaign's licence.
  const allowed = new Map(
    db
      .select({ id: schema.listings.id, allowed: schema.listings.allowedLicenses })
      .from(schema.listings)
      .where(eq(schema.listings.status, "active"))
      .all()
      .map((r) => [r.id, r.allowed]),
  );
  const offered = (listingId: string) => allowed.get(listingId)?.includes(c.license) ?? false;
  const candidates = market.active
    .filter((a) => (!only || only.includes(a.listingId)) && !already.has(a.listingId))
    .filter((a) => matchesCriteria(a.traits, criteria))
    // Never the team's own members' work, nor a licence it already holds.
    .filter((a) => !members.has(a.sellerId))
    .filter((a) => !licensesHeld(db, c.buyerOrgId, a.listingId).includes(c.license))
    .filter((a) => offered(a.listingId))
    .map((a) => {
      const list = market.quote(a, c.license).priceCents;
      return {
        a,
        price: clearing ? Math.min(c.maxPriceCents, Math.max(list, clearing.priceCents)) : list,
      };
    })
    .filter((x) => x.price <= c.maxPriceCents)
    .sort((x, y) => x.price - y.price);
  let filled = 0;
  let escrow = balanceOf(db, Accounts.escrow(c.id));
  let count = c.filled;
  const bought: string[] = [];
  for (const { a, price } of candidates) {
    if (count >= c.quantity || price > escrow) break;
    const rows = loadSaleRows(db, [a.listingId]);
    db.transaction((tx) => {
      // Every order hangs off a quote: a one-line snapshot of the campaign's collection.
      const snapshotId = newId("csn");
      const quoteId = newId("quo");
      tx.insert(schema.collectionSnapshots)
        .values({
          id: snapshotId,
          collectionId: c.collectionId,
          version: count + 1,
          listingIds: [a.listingId],
          createdAt: now,
        })
        .run();
      tx.insert(schema.quotes)
        .values({
          id: quoteId,
          buyerOrgId: c.buyerOrgId,
          snapshotId,
          license: c.license,
          totalCents: price,
          breakdown: [
            {
              listingId: a.listingId,
              title: rows.get(a.listingId)?.title ?? null,
              priceCents: price,
            },
          ],
          expiresAt: now,
          createdAt: now,
        })
        .run();
      const orderId = writeOrderTx(tx, deps, {
        orgId: c.buyerOrgId,
        quoteId,
        license: c.license,
        lines: [{ listingId: a.listingId, priceCents: price }],
        rows,
        fundingAccount: Accounts.escrow(c.id),
        now,
        via: clearing ? `${clearing.via} (the campaign “${c.title}”)` : `the campaign “${c.title}”`,
      });
      tx.insert(schema.campaignFills)
        .values({
          id: newId("cfl"),
          campaignId: c.id,
          listingId: a.listingId,
          orderId,
          priceCents: price,
          createdAt: now,
        })
        .run();
      tx.insert(schema.collectionItems)
        .values({ collectionId: c.collectionId, listingId: a.listingId, addedAt: now })
        .onConflictDoNothing()
        .run();
      // The counters commit with the purchase, so a failure on a later
      // candidate can never leave the campaign under-counted (and able to
      // buy past its quantity on the next run).
      tx.update(schema.campaigns)
        .set({ filled: count + 1, spentCents: c.budgetCents - (escrow - price) })
        .where(eq(schema.campaigns.id, c.id))
        .run();
    });
    escrow -= price;
    count++;
    filled++;
    bought.push(a.listingId);
  }
  if (filled) {
    deps.bus.emit(EventTypes.OrderPaid, { campaignId: c.id, lines: filled });
    const rows = loadSaleRows(db, bought);
    recordPurchases(
      db,
      deps,
      c.buyerOrgId,
      bought.map((id) => rows.get(id)!.traits),
      now,
    );
  }
  if (count >= c.quantity) closeCampaign(db, deps, c.id, "filled");
  return filled;
}

/** End a campaign and return what is left in escrow to the buyer. */
export function closeCampaign(
  db: Db,
  deps: Pick<CampaignDeps, "now">,
  campaignId: string,
  status: "filled" | "expired" | "closed",
): void {
  const c = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).get();
  if (!c || c.status !== "open") return;
  const left = balanceOf(db, Accounts.escrow(c.id));
  db.transaction((tx) => {
    tx.update(schema.campaigns).set({ status }).where(eq(schema.campaigns.id, c.id)).run();
    if (left > 0) {
      postTransaction(tx, {
        kind: "campaign_refund",
        refType: "campaign",
        refId: c.id,
        lines: [
          { account: Accounts.escrow(c.id), amountCents: -left },
          { account: Accounts.buyer(c.buyerOrgId), amountCents: left },
        ],
      });
    }
  });
}

export function cancelCampaign(
  db: Db,
  deps: CampaignDeps,
  user: PublicUser,
  campaignId: string,
): void {
  const orgId = orgOf(user);
  const c = db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.buyerOrgId, orgId)))
    .get();
  if (!c) throw new CampaignError("No such campaign.");
  closeCampaign(db, deps, c.id, "closed");
}

/** Expire campaigns past their date (refunding escrow). Cheap; call on page loads. */
export function expireCampaigns(db: Db, deps: Pick<CampaignDeps, "now">): number {
  const now = deps.now ?? new Date();
  const due = db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.status, "open"), lte(schema.campaigns.expiresAt, now)))
    .all();
  for (const d of due) closeCampaign(db, deps, d.id, "expired");
  return due.length;
}

/** What a campaign would pay for a listing at list price, or why it can't bid. */
function bidFor(
  db: Db,
  market: ReturnType<typeof buildMarket>,
  c: CampaignRow,
  listingId: string,
): number | undefined {
  if (c.status !== "open" || c.filled >= c.quantity) return undefined;
  const a = market.active.find((x) => x.listingId === listingId);
  if (!a || !matchesCriteria(a.traits, c.criteria as DemandCriteria)) return undefined;
  if (orgMemberIds(db, c.buyerOrgId).has(a.sellerId)) return undefined;
  if (licensesHeld(db, c.buyerOrgId, listingId).includes(c.license)) return undefined;
  const list = market.quote(a, c.license).priceCents;
  if (list > c.maxPriceCents || list > balanceOf(db, Accounts.escrow(c.id))) return undefined;
  return list;
}

export interface AuctionResult {
  listingId: string;
  /** Bids, highest first: each campaign's maximum price. */
  bids: { campaignId: string; maxPriceCents: number }[];
  winner: string;
  /** What the winner paid: the second-highest bid, or the list price if higher. */
  priceCents: number;
  listPriceCents: number;
}

/**
 * A new listing goes to auction among the open campaigns that want it
 * (different teams; one bid each, their maximum price). The highest bid
 * wins and pays the second-highest bid, or the list price if that is
 * higher (the reserve), never more than its own bid: a second-price auction,
 * so bidding your true value is the best strategy. With one bidder it
 * clears at the list price. Losing teams are told the price they lost at.
 */
export function auctionListing(
  db: Db,
  deps: CampaignDeps,
  listingId: string,
): AuctionResult | undefined {
  const now = deps.now ?? new Date();
  const market = buildMarket(db, { config: deps.config, now });
  const open = db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.status, "open"))
    .orderBy(desc(schema.campaigns.maxPriceCents), asc(schema.campaigns.createdAt))
    .all()
    .filter((c) => c.expiresAt.getTime() > now.getTime());
  const eligible: { c: CampaignRow; list: number }[] = [];
  for (const c of open) {
    // One bid per team: its highest campaign.
    if (eligible.some((e) => e.c.buyerOrgId === c.buyerOrgId)) continue;
    const list = bidFor(db, market, c, listingId);
    if (list !== undefined) eligible.push({ c, list });
  }
  if (!eligible.length) return undefined;
  const [win, second] = eligible;
  const price = Math.min(
    win!.c.maxPriceCents,
    Math.max(win!.list, second?.c.maxPriceCents ?? 0),
    balanceOf(db, Accounts.escrow(win!.c.id)),
  );
  const via = eligible.length > 1 ? `an auction among ${eligible.length} campaigns` : "a campaign";
  const filled = clearCampaign(db, deps, win!.c.id, [listingId], {
    priceCents: price,
    via,
  });
  if (!filled) return undefined;
  for (const lost of eligible.slice(1)) {
    for (const userId of orgMemberIds(db, lost.c.buyerOrgId)) {
      notify(db, userId, {
        kind: "outbid",
        title: `Outbid on a trace for “${lost.c.title}”`,
        body: `Another campaign bid more. It paid $${(price / 100).toFixed(2)}; your bid was $${(lost.c.maxPriceCents / 100).toFixed(2)}. Raise your maximum to win the next one.`,
        href: `/traces/${listingId}`,
        now,
      });
    }
  }
  const result: AuctionResult = {
    listingId,
    bids: eligible.map((e) => ({ campaignId: e.c.id, maxPriceCents: e.c.maxPriceCents })),
    winner: win!.c.id,
    priceCents: price,
    listPriceCents: win!.list,
  };
  deps.bus.emit(EventTypes.BountyMatched, result);
  return result;
}

/**
 * Event consumer: each new listing is auctioned among the open campaigns
 * that want it (see auctionListing). Called after a share and after the
 * simulator adds supply.
 */
export function runCampaignConsumer(db: Db, deps: CampaignDeps): number {
  expireCampaigns(db, deps);
  const BATCH = 10_000;
  let filled = 0;
  // Drain the whole backlog, batch by batch, so a listing created behind a
  // long history (an upgraded database) is still offered to campaigns now.
  for (;;) {
    const batch = deps.bus.peek("campaigns", BATCH);
    if (!batch.length) break;
    const listingIds = batch
      .filter((e) => e.type === EventTypes.ListingCreated)
      .map((e) => (e.payload as { listingId?: string }).listingId)
      .filter((x): x is string => Boolean(x));
    for (const id of listingIds) if (auctionListing(db, deps, id)) filled++;
    deps.bus.ack("campaigns", batch.at(-1)!.seq);
    if (batch.length < BATCH) break;
  }
  return filled;
}

/** How many campaigns have bought a listing. */
export function campaignFillsFor(db: Db, listingId: string): number {
  return db
    .select({ id: schema.campaignFills.id })
    .from(schema.campaignFills)
    .where(eq(schema.campaignFills.listingId, listingId))
    .all().length;
}

function view(db: Db, c: CampaignRow): CampaignView {
  const fills = db
    .select({
      listingId: schema.campaignFills.listingId,
      priceCents: schema.campaignFills.priceCents,
      createdAt: schema.campaignFills.createdAt,
      title: schema.traces.title,
    })
    .from(schema.campaignFills)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.campaignFills.listingId))
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.campaignFills.campaignId, c.id))
    .orderBy(desc(schema.campaignFills.createdAt))
    .all();
  return {
    ...c,
    criteria: c.criteria as DemandCriteria,
    escrowCents: balanceOf(db, Accounts.escrow(c.id)),
    fills,
  };
}

export function listCampaigns(db: Db, orgId: string): CampaignView[] {
  return db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.buyerOrgId, orgId))
    .orderBy(desc(schema.campaigns.createdAt))
    .all()
    .map((c) => view(db, c));
}

/** Open campaigns, for sellers: what buyers are standing ready to buy. */
export function openCampaigns(db: Db): CampaignView[] {
  return db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.status, "open"))
    .orderBy(desc(schema.campaigns.maxPriceCents))
    .all()
    .map((c) => view(db, c));
}

export function getCampaign(db: Db, user: PublicUser, id: string): CampaignView | undefined {
  const orgId = orgOf(user);
  const c = db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.buyerOrgId, orgId)))
    .get();
  return c ? view(db, c) : undefined;
}
