import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadConfig, type MarketplaceConfig } from "@tm/config";
import { newId, openDb, runMigrations, schema, type Db } from "@tm/db";
import { comboKeyOf, type TraceTraits } from "@tm/enrich";
import {
  createDbEventBus,
  EventTypes,
  priceHistory,
  quoteListing,
  recordDemandSignal,
  repriceAll,
  runPricingConsumer,
  lastRefreshAt,
  refreshStalePrices,
  type EventBus,
} from "../index";

const NOW = new Date("2026-10-15T12:00:00Z");
let db: Db;
let bus: EventBus;
let config: MarketplaceConfig;
let sellerId: string;
let n = 0;

beforeEach(() => {
  db = openDb(":memory:");
  runMigrations(db);
  bus = createDbEventBus(db);
  config = loadConfig();
  sellerId = newId("usr");
  db.insert(schema.users)
    .values({
      id: sellerId,
      email: "s@example.com",
      passwordHash: "x",
      displayName: "S",
      role: "seller",
    })
    .run();
});

function baseTraits(over: Partial<TraceTraits> = {}): TraceTraits {
  return {
    turns: 20,
    toolCalls: 5,
    toolErrors: 1,
    userCorrections: 0,
    interrupts: 0,
    hadFailure: true,
    recovered: false,
    preferencePairs: 0,
    testsRanAtEnd: false,
    testsPassedAtEnd: false,
    truncated: false,
    redactionDensity: 0,
    language: "TypeScript",
    framework: "React",
    failureCategory: "tool_error",
    model: "claude-sonnet-4-5",
    modelDeprecated: false,
    capturedAt: NOW.toISOString(),
    durationMinutes: 10,
    domain: "software_engineering",
    domainConfidence: 0.9,
    domains: [{ domain: "software_engineering", share: 1 }],
    ...over,
  };
}

/** Insert a trace, its traits and an active listing. Returns the listing id. */
function addListing(
  traits: TraceTraits,
  opts: { source?: "real" | "synthetic"; status?: "active" | "delisted"; hash?: string } = {},
): string {
  const traceId = newId("trc");
  const assetId = newId("ast");
  const listingId = newId("lst");
  n++;
  db.insert(schema.traces)
    .values({
      id: traceId,
      sellerId,
      schemaVersion: 1,
      source: opts.source ?? "real",
      harness: "claude-code",
      model: traits.model,
      language: traits.language,
      framework: traits.framework,
      startedAt: NOW,
      endedAt: NOW,
      turnCount: traits.turns,
      toolCallCount: traits.toolCalls,
      contentHash: opts.hash ?? `hash${n}`,
      blobKey: `blobs/${traceId}.json`,
    })
    .run();
  db.insert(schema.traceTraits)
    .values({ traceId, data: traits, comboKey: comboKeyOf(traits) })
    .run();
  db.insert(schema.assets).values({ id: assetId, traceId, kind: "scrubbed_trace" }).run();
  db.insert(schema.listings)
    .values({
      id: listingId,
      assetId,
      traceId,
      tier: 0,
      status: opts.status ?? "active",
      allowedLicenses: ["research", "eval", "training"],
    })
    .run();
  return listingId;
}

const priceOf = (id: string) =>
  db.select().from(schema.listings).where(eq(schema.listings.id, id)).get()!.currentPriceCents!;

const rust = (over: Partial<TraceTraits> = {}) =>
  baseTraits({ language: "Rust", framework: "Tokio", failureCategory: "retry_loop", ...over });

describe("repriceAll", () => {
  it("prices every active listing, writes a snapshot and announces changes", () => {
    const a = addListing(baseTraits());
    const r = repriceAll(db, { config, now: NOW, reason: "test", bus });
    expect(r).toEqual({ repriced: 1, changed: 1 });
    expect(priceOf(a)).toBeGreaterThan(0);
    expect(priceHistory(db, a)).toHaveLength(1);
    let seen = 0;
    bus.poll("t", (e) => e.type === EventTypes.PriceUpdated && seen++);
    expect(seen).toBe(1);
  });

  it("writes nothing when no price changed", () => {
    addListing(baseTraits());
    repriceAll(db, { config, now: NOW, reason: "first" });
    expect(repriceAll(db, { config, now: NOW, reason: "second" }).changed).toBe(0);
  });

  it("lowers a trace's price as its combination becomes common (rarity)", () => {
    const rare = addListing(rust());
    for (let i = 0; i < 4; i++) addListing(baseTraits()); // a common combination
    repriceAll(db, { config, now: NOW, reason: "start" });
    const before = priceOf(rare);
    for (let i = 0; i < 12; i++) addListing(rust()); // flood the Rust combination
    repriceAll(db, { config, now: NOW, reason: "flood" });
    expect(priceOf(rare)).toBeLessThan(before);
    expect(priceHistory(db, rare).map((h) => h.reason)).toEqual(["start", "flood"]);
  });

  it("does not let copies of the same content create scarcity or volume", () => {
    const a = addListing(rust(), { hash: "same" });
    addListing(baseTraits());
    repriceAll(db, { config, now: NOW, reason: "start" });
    const before = priceOf(a);
    for (let i = 0; i < 5; i++) addListing(rust(), { hash: "same" });
    repriceAll(db, { config, now: NOW, reason: "copies" });
    expect(priceOf(a)).toBe(before);
  });

  it("raises matching prices when buyers signal demand, and only those", () => {
    const r = addListing(rust());
    const ts = addListing(baseTraits());
    repriceAll(db, { config, now: NOW, reason: "start" });
    const [r0, t0] = [priceOf(r), priceOf(ts)];
    recordDemandSignal(db, bus, {
      kind: "bounty",
      criteria: { language: "Rust" },
      weight: 0.4,
      now: NOW,
    });
    repriceAll(db, { config, now: NOW, reason: "bounty" });
    expect(priceOf(r) / r0).toBeCloseTo(1.2, 1);
    expect(priceOf(ts)).toBe(t0);
  });

  it("ignores delisted listings in the market and leaves their price alone", () => {
    const gone = addListing(rust(), { status: "delisted" });
    const live = addListing(rust());
    const r = repriceAll(db, { config, now: NOW, reason: "start" });
    expect(r.repriced).toBe(1);
    expect(priceOf(live)).toBeGreaterThan(0);
    expect(
      db.select().from(schema.listings).where(eq(schema.listings.id, gone)).get()!
        .currentPriceCents,
    ).toBeNull();
  });

  it("limits demand swings against a snapshot older than the change window", () => {
    const l = addListing(rust());
    const yesterday = new Date(NOW.getTime() - 25 * 3_600_000);
    repriceAll(db, { config, now: yesterday, reason: "yesterday" }); // demand 1.0
    recordDemandSignal(db, bus, {
      kind: "bounty",
      criteria: { language: "Rust" },
      weight: 50,
      now: NOW,
    });
    const q = quoteListing(db, l, "research", { config, now: NOW })!;
    expect(q.factors.demand).toBeCloseTo(1.2, 5); // would be 2.0 without the limit
  });

  it("can exclude synthetic traces from rarity counts (production setting)", () => {
    const real = addListing(rust());
    addListing(baseTraits());
    for (let i = 0; i < 10; i++) addListing(rust(), { source: "synthetic" });
    const strict = loadConfig({
      fileOverrides: { pricing: { rarity: { includeSynthetic: false } } },
    });
    const demo = quoteListing(db, real, "research", { config, now: NOW })!;
    const prod = quoteListing(db, real, "research", { config: strict, now: NOW })!;
    expect(prod.factors.rarity).toBeGreaterThan(demo.factors.rarity);
  });
});

describe("quoteListing", () => {
  it("applies the license and writes nothing", () => {
    const l = addListing(rust());
    const research = quoteListing(db, l, "research", { config, now: NOW })!;
    const training = quoteListing(db, l, "training", { config, now: NOW })!;
    expect(training.priceCents).toBe(research.priceCents * 2);
    expect(priceHistory(db, l)).toHaveLength(0);
    expect(quoteListing(db, "missing", "research", { config, now: NOW })).toBeUndefined();
  });
});

describe("runPricingConsumer", () => {
  it("reprices once per batch of relevant events, then idles", () => {
    const l = addListing(rust());
    bus.emit(EventTypes.ListingCreated, { listingId: l });
    bus.emit(EventTypes.TraceIngested, {});
    bus.emit(EventTypes.OrderPaid, {}); // not a pricing trigger
    const r = runPricingConsumer(db, bus, { config, now: NOW });
    expect(r).toEqual({ repriced: 1, changed: 1 });
    expect(priceHistory(db, l)[0]!.reason).toBe("listing.created,trace.ingested");
    // Its own price.updated event does not trigger another run.
    expect(runPricingConsumer(db, bus, { config, now: NOW })).toBeNull();
  });
  it("refreshes time-dependent prices with no new events once they are stale", () => {
    const l = addListing(rust());
    recordDemandSignal(db, bus, {
      kind: "bounty",
      criteria: { language: "Rust" },
      weight: 0.4,
      now: NOW,
    });
    runPricingConsumer(db, bus, { config, now: NOW });
    const withDemand = priceOf(l);

    // Within the refresh interval nothing runs.
    const soon = new Date(NOW.getTime() + 30 * 60_000);
    expect(runPricingConsumer(db, bus, { config, now: soon })).toBeNull();

    // Past the demand window, with no new events, the bounty has aged out
    // and the trace is older: the price must come down on its own.
    const later = new Date(NOW.getTime() + (config.pricing.demand.windowDays + 1) * 86_400_000);
    const r = runPricingConsumer(db, bus, { config, now: later });
    expect(r?.changed).toBe(1);
    expect(priceOf(l)).toBeLessThan(withDemand);
    expect(priceHistory(db, l).at(-1)!.reason).toBe("scheduled refresh");
    expect(lastRefreshAt(db)?.toISOString()).toBe(later.toISOString());
    expect(refreshStalePrices(db, bus, { config, now: later })).toBeNull();
  });
});
