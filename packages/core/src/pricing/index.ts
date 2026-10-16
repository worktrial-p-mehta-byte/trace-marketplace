import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { newId, schema, type Db } from "@tm/db";
import type { TraceTraits } from "@tm/enrich";
import {
  demandPressure,
  matchesCriteria,
  median,
  traitPolicyV1,
  type DemandCriteria,
  type DemandSignalInput,
  type PriceFactors,
  type PriceQuote,
  type PricingPolicy,
} from "@tm/pricing";
import type { LicenseScope, Tier } from "@tm/schema";
import { EventTypes, type EventBus } from "../events";

interface ActiveListing {
  listingId: string;
  traceId: string;
  tier: Tier;
  currentPriceCents: number | null;
  traits: TraceTraits;
  comboKey: string;
  source: "real" | "staged" | "synthetic";
  contentHash: string;
}

export interface PricingDeps {
  config: MarketplaceConfig;
  now?: Date;
  policy?: PricingPolicy<TraceTraits>;
}

function loadActive(db: Db): ActiveListing[] {
  return db
    .select({
      listingId: schema.listings.id,
      traceId: schema.listings.traceId,
      tier: schema.listings.tier,
      currentPriceCents: schema.listings.currentPriceCents,
      traits: schema.traceTraits.data,
      comboKey: schema.traceTraits.comboKey,
      source: schema.traces.source,
      contentHash: schema.traces.contentHash,
    })
    .from(schema.listings)
    .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.listings.traceId))
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.listings.status, "active"))
    .all()
    .map((r) => ({ ...r, tier: r.tier as Tier, traits: r.traits as TraceTraits }));
}

function loadSignals(db: Db, since: Date): DemandSignalInput[] {
  return db
    .select()
    .from(schema.demandSignals)
    .where(gte(schema.demandSignals.createdAt, since))
    .all()
    .map((s) => ({
      criteria: s.criteria as DemandCriteria,
      weight: s.weight,
      createdAt: s.createdAt,
    }));
}

/** Demand factor from the newest snapshot at least `changeWindowHours` old. */
function baselineDemand(db: Db, listingId: string, before: Date): number | undefined {
  const row = db
    .select({ factors: schema.priceSnapshots.factors })
    .from(schema.priceSnapshots)
    .where(
      and(
        eq(schema.priceSnapshots.listingId, listingId),
        lte(schema.priceSnapshots.createdAt, before),
      ),
    )
    .orderBy(desc(schema.priceSnapshots.createdAt))
    .limit(1)
    .get();
  return (row?.factors as PriceFactors | undefined)?.demand;
}

/**
 * Snapshot of the market used to price every active listing: rarity counts
 * per combination (distinct content, so copies don't create scarcity), the
 * median, recent demand signals and supply per signal.
 */
export function buildMarket(db: Db, deps: PricingDeps) {
  const now = deps.now ?? new Date();
  const c = deps.config.pricing;
  const active = loadActive(db);

  const counted = (includeSynthetic: boolean) => {
    const seen = new Map<string, Set<string>>();
    for (const r of active) {
      if (!includeSynthetic && r.source === "synthetic") continue;
      const set = seen.get(r.comboKey) ?? new Set<string>();
      set.add(r.contentHash);
      seen.set(r.comboKey, set);
    }
    return new Map([...seen].map(([k, v]) => [k, v.size]));
  };
  const comboCounts = counted(c.rarity.includeSynthetic);
  const medianComboCount = median([...comboCounts.values()]);

  const signals = loadSignals(db, new Date(now.getTime() - c.demand.windowDays * 86_400_000));
  const supplyCache = new Map<string, number>();
  const supplyFor = (crit: DemandCriteria) => {
    const key = JSON.stringify(crit);
    let n = supplyCache.get(key);
    if (n === undefined) {
      n = active.filter((r) => matchesCriteria(r.traits, crit)).length;
      supplyCache.set(key, n);
    }
    return n;
  };

  const baselineBefore = new Date(now.getTime() - c.demand.changeWindowHours * 3_600_000);

  return {
    now,
    active,
    comboCounts,
    medianComboCount,
    /** Demand pressure on any traits, listed or not. */
    pressureFor(traits: TraceTraits): number {
      return demandPressure(traits, signals, supplyFor, now, c.demand.windowDays);
    },
    quote(row: ActiveListing, license: LicenseScope = "research"): PriceQuote {
      const policy = deps.policy ?? traitPolicyV1;
      return policy.price({
        traits: row.traits,
        tier: row.tier,
        license,
        config: c,
        market: {
          comboCount: comboCounts.get(row.comboKey) ?? 1,
          medianComboCount,
          demandPressure: demandPressure(row.traits, signals, supplyFor, now, c.demand.windowDays),
          baselineDemand: baselineDemand(db, row.listingId, baselineBefore),
          now,
        },
      });
    },
  };
}

export interface RepriceResult {
  repriced: number;
  changed: number;
}

/**
 * Recompute the list price (research license) of every active listing.
 * Writes a PriceSnapshot and emits price.updated for each price that changed.
 */
export function repriceAll(
  db: Db,
  deps: PricingDeps & { reason: string; bus?: EventBus },
): RepriceResult {
  const market = buildMarket(db, deps);
  let changed = 0;
  db.transaction((tx) => {
    for (const row of market.active) {
      const q = market.quote(row);
      if (q.priceCents === row.currentPriceCents) continue;
      changed++;
      tx.insert(schema.priceSnapshots)
        .values({
          id: newId("psn"),
          listingId: row.listingId,
          priceCents: q.priceCents,
          factors: q.factors,
          reason: deps.reason,
          createdAt: market.now,
        })
        .run();
      tx.update(schema.listings)
        .set({ currentPriceCents: q.priceCents, priceUpdatedAt: market.now })
        .where(eq(schema.listings.id, row.listingId))
        .run();
    }
  });
  if (deps.bus && changed) {
    deps.bus.emit(EventTypes.PriceUpdated, { reason: deps.reason, changed });
  }
  deps.bus?.emit(EventTypes.PricesRefreshed, {
    at: market.now.toISOString(),
    reason: deps.reason,
    changed,
  });
  return { repriced: market.active.length, changed };
}

/** When the whole catalog was last repriced (logical time), if ever. */
export function lastRefreshAt(db: Db): Date | undefined {
  const row = db
    .select({ payload: schema.events.payload })
    .from(schema.events)
    .where(eq(schema.events.type, EventTypes.PricesRefreshed))
    .orderBy(desc(schema.events.seq))
    .limit(1)
    .get();
  const at = (row?.payload as { at?: string } | undefined)?.at;
  return at ? new Date(at) : undefined;
}

/**
 * Prices depend on time as well as events: freshness decays and demand
 * signals age out of their window. Reprice everything when the last full
 * reprice is older than `pricing.refreshIntervalMinutes`. Cheap to call on
 * every page load; a cron job can call it too (`pnpm reprice`).
 */
export function refreshStalePrices(db: Db, bus: EventBus, deps: PricingDeps): RepriceResult | null {
  const now = deps.now ?? new Date();
  const last = lastRefreshAt(db);
  const interval = deps.config.pricing.refreshIntervalMinutes * 60_000;
  if (last && now.getTime() - last.getTime() < interval) return null;
  return repriceAll(db, { ...deps, now, bus, reason: "scheduled refresh" });
}

/** Price one active listing under a license without writing anything (quotes, "why this price"). */
export function quoteListing(
  db: Db,
  listingId: string,
  license: LicenseScope,
  deps: PricingDeps,
): PriceQuote | undefined {
  const market = buildMarket(db, deps);
  const row = market.active.find((r) => r.listingId === listingId);
  return row ? market.quote(row, license) : undefined;
}

/** Price history for a listing, oldest first (for the price chart). */
export function priceHistory(db: Db, listingId: string) {
  return db
    .select({
      priceCents: schema.priceSnapshots.priceCents,
      reason: schema.priceSnapshots.reason,
      createdAt: schema.priceSnapshots.createdAt,
    })
    .from(schema.priceSnapshots)
    .where(eq(schema.priceSnapshots.listingId, listingId))
    .orderBy(schema.priceSnapshots.createdAt)
    .all();
}

/** Record a buyer search, save or bounty as demand, and announce it. */
export function recordDemandSignal(
  db: Db,
  bus: EventBus,
  s: {
    kind: "search" | "view" | "save" | "bounty";
    criteria: DemandCriteria;
    weight?: number;
    buyerOrgId?: string;
    now?: Date;
  },
): string {
  const id = newId("dsg");
  db.insert(schema.demandSignals)
    .values({
      id,
      kind: s.kind,
      criteria: s.criteria,
      weight: s.weight ?? 1,
      buyerOrgId: s.buyerOrgId,
      createdAt: s.now ?? new Date(),
    })
    .run();
  bus.emit(EventTypes.DemandSignaled, { id, kind: s.kind });
  return id;
}

/** Events that can move prices. */
export const PRICING_TRIGGERS = new Set<string>([
  EventTypes.TraceIngested,
  EventTypes.ListingCreated,
  EventTypes.ListingDelisted,
  EventTypes.ConsentRevoked,
  EventTypes.DemandSignaled,
  EventTypes.BountyPosted,
]);

/**
 * Event consumer: if anything that moves prices happened since the last
 * run, reprice the whole catalog once. v0 catalogs are small; production
 * would reprice only affected combinations.
 */
export function runPricingConsumer(db: Db, bus: EventBus, deps: PricingDeps): RepriceResult | null {
  // Acknowledge only after repricing succeeds: if it throws, the triggers stay
  // in the outbox and the very next run (e.g. the next page load) retries,
  // rather than waiting for the scheduled refresh.
  const batch = bus.peek("pricing", 10_000);
  const triggers = new Set(batch.map((e) => e.type).filter((t) => PRICING_TRIGGERS.has(t)));
  const result = triggers.size
    ? repriceAll(db, { ...deps, bus, reason: [...triggers].sort().join(",") })
    : refreshStalePrices(db, bus, deps);
  const last = batch.at(-1);
  if (last) bus.ack("pricing", last.seq);
  return result;
}
