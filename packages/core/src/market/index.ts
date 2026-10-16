import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { newId, schema, type Db } from "@tm/db";
import { matchesCriteria, type DemandCriteria } from "@tm/pricing";
import { generateFlood, type Pattern } from "@tm/synth";
import { acceptTerms, createUser, TERMS_VERSION, type PublicUser } from "../auth";
import { DuplicateShareError, shareTrace, type CatalogDeps } from "../catalog";
import { EventTypes, type EventBus } from "../events";
import { buildMarket, priceHistory, recordDemandSignal, runPricingConsumer } from "../pricing";
import { runSearchConsumer } from "../search";

/** The account that owns supply added by the simulator, so it can be removed again. */
export const SIMULATOR_SELLER_EMAIL = "market-simulator@example.com";

/** Find or create an internal account (seed sellers, the simulator) with terms accepted. */
export async function ensureAccount(
  db: Db,
  email: string,
  role: "seller" | "buyer" | "both",
  displayName: string,
  password?: string,
): Promise<PublicUser> {
  const row = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (row) {
    if (row.termsAcceptedVersion !== TERMS_VERSION) acceptTerms(db, row.id);
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      buyerOrgId: row.buyerOrgId,
      termsAcceptedVersion: TERMS_VERSION,
    };
  }
  const u = await createUser(db, {
    email,
    role,
    displayName,
    password: password ?? randomBytes(18).toString("base64url"),
  });
  acceptTerms(db, u.id);
  return { ...u, termsAcceptedVersion: TERMS_VERSION };
}

export interface PriceMove {
  listingId: string;
  title: string | null;
  before: number;
  after: number;
}

/** Current prices of active listings matching some criteria. */
function pricesMatching(db: Db, config: MarketplaceConfig, criteria: DemandCriteria) {
  const market = buildMarket(db, { config });
  const rows = db
    .select({
      id: schema.listings.id,
      price: schema.listings.currentPriceCents,
      title: schema.traces.title,
    })
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.listings.status, "active"))
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, { title: string | null; price: number }>();
  for (const a of market.active) {
    if (!matchesCriteria(a.traits, criteria)) continue;
    const r = byId.get(a.listingId);
    if (r) out.set(a.listingId, { title: r.title, price: r.price ?? 0 });
  }
  return out;
}

function moves(
  before: Map<string, { title: string | null; price: number }>,
  after: Map<string, { title: string | null; price: number }>,
): PriceMove[] {
  return [...before]
    .filter(([id]) => after.has(id))
    .map(([id, b]) => ({
      listingId: id,
      title: b.title,
      before: b.price,
      after: after.get(id)!.price,
    }))
    .sort((a, b) => b.after - a.after);
}

export interface BountyInput {
  buyerOrgId: string;
  title: string;
  criteria: DemandCriteria;
  perTraceCents: number;
  quantity: number;
  now?: Date;
}

/**
 * A buyer posts a bounty: "N traces like this, $X each". It is recorded as a
 * strong demand signal (weight = budget in dollars × bountyWeightPerDollar)
 * spread over the listings it matches, then prices are recomputed.
 */
export function postBounty(
  db: Db,
  deps: { config: MarketplaceConfig; bus: EventBus },
  input: BountyInput,
): { bountyId: string; weight: number; moves: PriceMove[] } {
  const before = pricesMatching(db, deps.config, input.criteria);
  const bountyId = newId("bty");
  const now = input.now ?? new Date();
  db.insert(schema.bounties)
    .values({
      id: bountyId,
      buyerOrgId: input.buyerOrgId,
      title: input.title,
      spec: input.criteria,
      perTraceCents: input.perTraceCents,
      quantity: input.quantity,
      status: "open",
      createdAt: now,
    })
    .run();
  const weight =
    ((input.perTraceCents * input.quantity) / 100) *
    deps.config.pricing.demand.bountyWeightPerDollar;
  recordDemandSignal(db, deps.bus, {
    kind: "bounty",
    criteria: input.criteria,
    weight,
    buyerOrgId: input.buyerOrgId,
    now,
  });
  deps.bus.emit(EventTypes.BountyPosted, { bountyId });
  runPricingConsumer(db, deps.bus, { config: deps.config, now });
  return {
    bountyId,
    weight,
    moves: moves(before, pricesMatching(db, deps.config, input.criteria)),
  };
}

export interface FloodInput {
  language: string;
  framework?: string;
  pattern: Pattern;
  count: number;
  seed?: number;
}

/**
 * Add `count` synthetic sessions of one stack and failure pattern, as the
 * simulator account, so that combination stops being rare. Then reprice.
 */
export async function floodSupply(db: Db, deps: CatalogDeps, input: FloodInput) {
  const criteria: DemandCriteria = {
    language: input.language,
    framework: input.framework,
    failure: input.pattern === "clean" ? undefined : input.pattern,
  };
  const before = pricesMatching(db, deps.config, criteria);
  const sim = await ensureAccount(db, SIMULATOR_SELLER_EMAIL, "seller", "Market simulator");
  const now = deps.now ?? new Date();
  const seed = input.seed ?? Math.floor(now.getTime() / 1000) % 1_000_000;
  const traces = generateFlood(seed, Math.min(100, Math.max(1, input.count)), now, input);
  let added = 0;
  for (const trace of traces) {
    try {
      await shareTrace(
        db,
        deps,
        { sellerId: sim.id, trace, tier: 0 },
        { allowSynthetic: true, deferMarket: true },
      );
      added++;
    } catch (err) {
      // A rare duplicate from the generator is skipped. Anything else (a blob
      // or database failure) must surface, not pass as a smaller flood.
      if (!(err instanceof DuplicateShareError)) throw err;
    }
  }
  runPricingConsumer(db, deps.bus, { config: deps.config, now });
  if (deps.search) await runSearchConsumer(db, deps.bus, deps.blobs, deps.search);
  return { added, moves: moves(before, pricesMatching(db, deps.config, criteria)) };
}

/**
 * Undo the simulator: close bounties, drop bounty demand, and withdraw every
 * listing the simulator added. Seeded and real listings are untouched.
 */
export async function resetSimulation(db: Db, deps: CatalogDeps) {
  const now = deps.now ?? new Date();
  db.delete(schema.demandSignals).where(eq(schema.demandSignals.kind, "bounty")).run();
  db.update(schema.bounties)
    .set({ status: "closed" })
    .where(eq(schema.bounties.status, "open"))
    .run();
  const sim = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, SIMULATOR_SELLER_EMAIL))
    .get();
  let withdrawn = 0;
  if (sim) {
    const live = db
      .select({ traceId: schema.consents.traceId })
      .from(schema.consents)
      .where(and(eq(schema.consents.sellerId, sim.id), isNull(schema.consents.revokedAt)))
      .all();
    db.transaction((tx) => {
      for (const { traceId } of live) {
        tx.update(schema.consents)
          .set({ revokedAt: now })
          .where(eq(schema.consents.traceId, traceId))
          .run();
        tx.update(schema.listings)
          .set({ status: "delisted" })
          .where(eq(schema.listings.traceId, traceId))
          .run();
      }
    });
    for (const { traceId } of live) deps.bus.emit(EventTypes.ListingDelisted, { traceId });
    withdrawn = live.length;
  }
  deps.bus.emit(EventTypes.ConsentRevoked, { reason: "simulator reset" });
  runPricingConsumer(db, deps.bus, { config: deps.config, now });
  if (deps.search) await runSearchConsumer(db, deps.bus, deps.blobs, deps.search);
  return { withdrawn };
}

/**
 * The listings a simulator view follows: the most expensive matches, with
 * history. Supply the simulator added is left out, so the view keeps
 * following the same listings while the market moves around them.
 */
export function watchList(db: Db, config: MarketplaceConfig, criteria: DemandCriteria, limit = 4) {
  const prices = pricesMatching(db, config, criteria);
  const sim = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, SIMULATOR_SELLER_EMAIL))
    .get();
  if (sim) {
    const simulated = db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
      .where(eq(schema.traces.sellerId, sim.id))
      .all();
    for (const { id } of simulated) prices.delete(id);
  }
  return [...prices]
    .sort((a, b) => b[1].price - a[1].price)
    .slice(0, limit)
    .map(([listingId, p]) => ({
      listingId,
      title: p.title,
      priceCents: p.price,
      history: priceHistory(db, listingId),
    }));
}

export function openBounties(db: Db) {
  return db.select().from(schema.bounties).where(eq(schema.bounties.status, "open")).all();
}
