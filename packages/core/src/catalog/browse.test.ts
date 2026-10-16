import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { loadConfig, type MarketplaceConfig } from "@tm/config";
import { newId, openDb, runMigrations, schema, type Db } from "@tm/db";
import { comboKeyOf, type TraceTraits } from "@tm/enrich";
import { TRACE_SCHEMA_VERSION, type Trace } from "@tm/schema";
import {
  listingTitle,
  acceptTerms,
  browseCatalog,
  canViewContent,
  createDbEventBus,
  createMemoryBlobStore,
  createSqliteSearchIndex,
  createUser,
  criteriaOf,
  ensureSearchIndex,
  getListingDetail,
  rebuildSearchIndex,
  recordBuyerInterest,
  runSearchConsumer,
  EventTypes,
  repriceAll,
  toFtsQuery,
  type EventBus,
  type PublicUser,
  type SearchIndex,
} from "../index";

const NOW = new Date();
let db: Db;
let bus: EventBus;
let config: MarketplaceConfig;
let blobs: ReturnType<typeof createMemoryBlobStore>;
let search: SearchIndex;
let seller: PublicUser;
let buyer: PublicUser;

function traits(over: Partial<TraceTraits>): TraceTraits {
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

async function add(o: {
  title: string;
  t: TraceTraits;
  labels: string[];
  tier?: 0 | 1;
  source?: "real" | "staged" | "synthetic";
  text?: string;
}): Promise<string> {
  const traceId = newId("trc");
  const assetId = newId("ast");
  const listingId = newId("lst");
  const blobKey = `traces/${traceId}.json`;
  const trace: Trace = {
    schemaVersion: TRACE_SCHEMA_VERSION,
    id: traceId,
    title: o.title,
    startedAt: NOW.toISOString(),
    endedAt: NOW.toISOString(),
    provenance: {
      source: o.source ?? "real",
      harness: { name: "claude-code" },
      model: { id: o.t.model },
      repo: { languages: [], frameworks: [] },
      capturedAt: NOW.toISOString(),
    },
    events: [
      { seq: 0, type: "user_message", text: o.text ?? "please fix it" },
      { seq: 1, type: "tool_call", callId: "c", tool: "Bash", input: { command: "cargo test" } },
      { seq: 2, type: "tool_result", callId: "c", output: "boom", isError: true },
    ],
  };
  await blobs.put(blobKey, JSON.stringify(trace));
  db.insert(schema.traces)
    .values({
      id: traceId,
      sellerId: seller.id,
      schemaVersion: 1,
      source: o.source ?? "real",
      title: o.title,
      harness: "claude-code",
      model: o.t.model,
      language: o.t.language,
      framework: o.t.framework,
      startedAt: NOW,
      endedAt: NOW,
      turnCount: o.t.turns,
      toolCallCount: o.t.toolCalls,
      contentHash: traceId,
      blobKey,
    })
    .run();
  db.insert(schema.traceTraits)
    .values({ traceId, data: o.t, comboKey: comboKeyOf(o.t) })
    .run();
  for (const code of o.labels) {
    db.insert(schema.labels)
      .values({
        id: newId("lbl"),
        traceId,
        kind: "failure",
        code,
        confidence: 1,
        source: "heuristic",
        evidence: [2],
      })
      .run();
  }
  db.insert(schema.assets).values({ id: assetId, traceId, kind: "scrubbed_trace", blobKey }).run();
  db.insert(schema.listings)
    .values({
      id: listingId,
      assetId,
      traceId,
      tier: o.tier ?? 0,
      status: "active",
      allowedLicenses: ["research"],
    })
    .run();
  return listingId;
}

let rustLoop: string, tsTamper: string, pyClean: string, rustSignals: string;

beforeEach(async () => {
  db = openDb(":memory:");
  runMigrations(db);
  bus = createDbEventBus(db);
  config = loadConfig();
  blobs = createMemoryBlobStore();
  search = createSqliteSearchIndex(db);
  seller = await createUser(db, { email: "s@example.com", password: "12345678", role: "seller" });
  acceptTerms(db, seller.id);
  buyer = await createUser(db, { email: "lab@example.com", password: "12345678", role: "buyer" });

  rustLoop = await add({
    title: "Async deadlock in the job queue",
    t: traits({
      language: "Rust",
      framework: "Tokio",
      failureCategory: "retry_loop",
      recovered: true,
      testsPassedAtEnd: true,
    }),
    labels: ["retry_loop", "tool_error"],
    text: "the tokio runtime deadlocks when the semaphore is held across await",
  });
  tsTamper = await add({
    title: "Date parsing test",
    t: traits({ language: "TypeScript", framework: "React", failureCategory: "test_tampering" }),
    labels: ["test_tampering", "user_correction"],
    text: "fix the timezone bug in parseDueDate",
  });
  pyClean = await add({
    title: "Add a README",
    t: traits({ language: "Python", hadFailure: false, toolErrors: 0, failureCategory: undefined }),
    labels: [],
    source: "synthetic",
  });
  rustSignals = await add({
    title: "Private Rust service",
    t: traits({ language: "Rust", failureCategory: "tool_error" }),
    labels: ["tool_error"],
    tier: 1,
    text: "secret internal details",
  });
  repriceAll(db, { config, reason: "test" });
  await rebuildSearchIndex(db, blobs, search);
});

describe("search consumer", () => {
  it("never re-indexes a listing withdrawn after its event was queued, and serialises runs", async () => {
    // Queue a listing.created for rustLoop, then withdraw it before any run handles the event.
    bus.emit(EventTypes.ListingCreated, { listingId: rustLoop });
    db.update(schema.listings)
      .set({ status: "delisted" })
      .where(eq(schema.listings.id, rustLoop))
      .run();
    await search.remove(rustLoop);
    // Two runs at once: both would peek the same batch without the lock.
    const [a, b] = await Promise.all([
      runSearchConsumer(db, bus, blobs, search),
      runSearchConsumer(db, bus, blobs, search),
    ]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    expect((await search.search({ text: "retry loop" })).ids).not.toContain(rustLoop);
  });
});

describe("search index", () => {
  it("builds safe prefix queries from free text", () => {
    expect(toFtsQuery('dead "lock" OR *')).toBe('"dead"* "lock"* "or"*');
    expect(toFtsQuery("  ...  ")).toBeNull();
  });

  it("finds open-source listings by their content, and others only by metadata", async () => {
    const signedIn = (text: string) => search.search({ text, includeContent: true });
    expect((await signedIn("semaphore")).ids).toEqual([rustLoop]);
    expect((await signedIn("timezone parse")).ids).toEqual([tsTamper]);
    // Signals-only content is never indexed.
    expect((await signedIn("internal details")).ids).toEqual([]);
    // Metadata (labels, language) is indexed for every listing.
    expect((await signedIn("retry loop")).ids).toEqual([rustLoop]);
  });

  it("never matches trace content for searches without content access", async () => {
    // Anonymous visitors can't read content, so they can't probe it by search.
    expect((await search.search({ text: "semaphore" })).ids).toEqual([]);
    expect((await search.search({ text: "timezone parse" })).ids).toEqual([]);
    // A mix of a metadata word and a content word must not match either.
    expect((await search.search({ text: "rust semaphore" })).ids).toEqual([]);
    // Metadata still works.
    expect((await search.search({ text: "retry loop" })).ids).toEqual([rustLoop]);
    expect((await search.search({ text: "rust" })).ids).toContain(rustLoop);
    // Through the catalog, too.
    const anon = await browseCatalog(db, { config, search }, { text: "semaphore" });
    const member = await browseCatalog(
      db,
      { config, search },
      { text: "semaphore", includeContent: true },
    );
    expect(anon.total).toBe(0);
    expect(member.items.map((i) => i.listingId)).toEqual([rustLoop]);
  });
});

describe("ensureSearchIndex", () => {
  it("rebuilds an index that is missing listings (e.g. after an upgrade), then leaves it alone", async () => {
    db.$client.prepare("DELETE FROM listing_search").run(); // like a fresh migration on an old database
    expect((await search.search({ text: "retry loop" })).ids).toEqual([]);
    expect(await ensureSearchIndex(db, blobs, search)).toBe(true);
    expect((await search.search({ text: "retry loop" })).ids).toEqual([rustLoop]);
    expect((await search.search({ text: "semaphore", includeContent: true })).ids).toEqual([
      rustLoop,
    ]);
    expect(await ensureSearchIndex(db, blobs, search)).toBe(false);
  });
});

describe("listingTitle", () => {
  it("gives the title of a listing for sale, and nothing once it is withdrawn", () => {
    expect(listingTitle(db, rustLoop)).toBe("Async deadlock in the job queue");
    expect(listingTitle(db, "lst_missing")).toBeUndefined();
    db.update(schema.listings)
      .set({ status: "delisted" })
      .where(eq(schema.listings.id, rustLoop))
      .run();
    expect(listingTitle(db, rustLoop)).toBeUndefined();
  });
});

describe("browseCatalog", () => {
  it("lists every active listing, most expensive first by default", async () => {
    const r = await browseCatalog(db, { config, search }, {});
    expect(r.total).toBe(4);
    const prices = r.items.map((i) => i.priceCents);
    expect(prices).toEqual([...prices].sort((a, b) => b - a));
  });

  it("filters by language, failure, outcome, tier and source", async () => {
    const ids = async (q: object) =>
      (await browseCatalog(db, { config, search }, q)).items.map((i) => i.listingId);
    expect(new Set(await ids({ language: "Rust" }))).toEqual(new Set([rustLoop, rustSignals]));
    expect(await ids({ failure: "test_tampering" })).toEqual([tsTamper]);
    expect(await ids({ outcome: "recovered" })).toEqual([rustLoop]);
    expect(await ids({ outcome: "clean" })).toEqual([pyClean]);
    expect(await ids({ tier: 1 })).toEqual([rustSignals]);
    expect(await ids({ source: "synthetic" })).toEqual([pyClean]);
    expect(await ids({ language: "Rust", tier: 0 })).toEqual([rustLoop]);
  });

  it("shows every failure type the labeler emits, including harness errors", async () => {
    const apiError = await add({
      title: "Session cut short by API errors",
      t: traits({ language: "Go", failureCategory: "harness_error" }),
      labels: ["harness_error"],
    });
    repriceAll(db, { config, reason: "test" });
    const r = await browseCatalog(db, { config, search }, { failure: "harness_error" });
    expect(r.items.map((i) => i.listingId)).toEqual([apiError]);
    expect(r.items[0]!.failures).toContain("harness_error");
    expect(r.facets.failure.find((f) => f.value === "harness_error")?.count).toBe(1);
  });

  it("combines free text with filters", async () => {
    const r = await browseCatalog(
      db,
      { config, search },
      { text: "tokio", language: "Rust", includeContent: true },
    );
    expect(r.items.map((i) => i.listingId)).toEqual([rustLoop]);
  });

  it("counts facets ignoring each facet's own filter", async () => {
    const r = await browseCatalog(db, { config, search }, { language: "Rust" });
    // The language facet still offers the other languages...
    expect(r.facets.language.map((f) => f.value).sort()).toEqual(["Python", "Rust", "TypeScript"]);
    // ...while other facets reflect the Rust filter.
    expect(r.facets.tier).toEqual([
      { value: "0", count: 1 },
      { value: "1", count: 1 },
    ]);
  });

  it("paginates and sorts", async () => {
    const page = await browseCatalog(
      db,
      { config, search },
      { sort: "price_asc", limit: 2, offset: 2 },
    );
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(2);
  });
});

describe("domains", () => {
  async function addMedical() {
    const id = await add({
      title: "Grade the triage answers",
      t: traits({
        domain: "medical",
        domainConfidence: 0.92,
        domains: [
          { domain: "medical", share: 0.8 },
          { domain: "education", share: 0.2 },
        ],
        failureCategory: "user_correction",
      }),
      labels: ["user_correction"],
    });
    const traceId = db
      .select({ t: schema.listings.traceId })
      .from(schema.listings)
      .where(eq(schema.listings.id, id))
      .get()!.t;
    db.insert(schema.labels)
      .values({
        id: newId("lbl"),
        traceId,
        kind: "domain",
        code: "medical",
        confidence: 0.92,
        source: "heuristic",
        evidence: [0],
      })
      .run();
    repriceAll(db, { config, reason: "test" });
    await rebuildSearchIndex(db, blobs, search);
    return id;
  }

  it("filters and facets by domain, with the distribution on each item", async () => {
    const med = await addMedical();
    const r = await browseCatalog(db, { config, search }, { domain: "medical" });
    expect(r.items.map((i) => i.listingId)).toEqual([med]);
    expect(r.items[0]!.domains[0]).toEqual({ domain: "medical", share: 0.8 });
    // The domain facet ignores its own filter.
    expect(r.facets.domain).toEqual([
      { value: "software_engineering", count: 4 },
      { value: "medical", count: 1 },
    ]);
  });

  it("treats traits stored before domains existed as unknown", async () => {
    const legacy = traits({ language: "Go" }) as Partial<TraceTraits>;
    delete legacy.domain;
    delete legacy.domains;
    const id = await add({ title: "Old row", t: legacy as TraceTraits, labels: [] });
    repriceAll(db, { config, reason: "test" });
    const r = await browseCatalog(db, { config, search }, { domain: "unknown" });
    expect(r.items.map((i) => i.listingId)).toEqual([id]);
    expect(r.items[0]!.domains).toEqual([]);
  });

  it("finds a session by its domain's name, not just its code", async () => {
    const med = await addMedical();
    const r = await browseCatalog(db, { config, search }, { text: "clinical evaluation" });
    expect(r.items.map((i) => i.listingId)).toEqual([med]);
  });

  it("turns a domain filter into demand that raises only that domain's prices", async () => {
    const med = await addMedical();
    expect(criteriaOf({ domain: "medical", text: "x" })).toEqual({ domain: "medical" });
    const price = async (id: string) =>
      (await browseCatalog(db, { config, search }, {})).items.find((i) => i.listingId === id)!
        .priceCents;
    const [medBefore, rustBefore] = [await price(med), await price(rustLoop)];
    expect(recordBuyerInterest(db, { config, bus }, buyer, "search", { domain: "medical" })).toBe(
      true,
    );
    expect(await price(med)).toBeGreaterThan(medBefore);
    expect(await price(rustLoop)).toBe(rustBefore);
  });
});

describe("buyer interest as demand", () => {
  it("records specific buyer searches as demand and reprices", async () => {
    const before = (await browseCatalog(db, { config, search }, {})).items.find(
      (i) => i.listingId === rustLoop,
    )!;
    expect(
      recordBuyerInterest(db, { config, bus }, buyer, "search", criteriaOf({ language: "Rust" })),
    ).toBe(true);
    const after = (await browseCatalog(db, { config, search }, {})).items.find(
      (i) => i.listingId === rustLoop,
    )!;
    expect(after.priceCents).toBeGreaterThan(before.priceCents);
  });

  it("ignores sellers, anonymous visitors and searches with no criteria", () => {
    expect(recordBuyerInterest(db, { config, bus }, seller, "search", { language: "Rust" })).toBe(
      false,
    );
    expect(
      recordBuyerInterest(db, { config, bus }, undefined, "search", { language: "Rust" }),
    ).toBe(false);
    expect(recordBuyerInterest(db, { config, bus }, buyer, "search", {})).toBe(false);
    expect(db.select().from(schema.demandSignals).all()).toEqual([]);
  });
});

describe("getListingDetail and the content policy", () => {
  it("shows open-source content to signed-in users, with prices for every license", async () => {
    const d = (await getListingDetail(db, { config, blobs }, rustLoop, buyer))!;
    expect(d.contentVisible).toBe(true);
    expect(JSON.stringify(d.trace)).toContain("semaphore");
    expect(d.quotes!.training.priceCents).toBe(d.quotes!.research.priceCents * 2);
    expect(d.sellerAlias).toMatch(/^Seller [0-9a-f]{6}$/);
    expect(d.isOwner).toBe(false);
  });

  it("never returns content the viewer may not see", async () => {
    const anon = (await getListingDetail(db, { config, blobs }, rustLoop, undefined))!;
    expect(anon.contentVisible).toBe(false);
    expect(JSON.stringify(anon.trace)).not.toContain("semaphore");
    const signals = (await getListingDetail(db, { config, blobs }, rustSignals, buyer))!;
    expect(JSON.stringify(signals.trace)).not.toContain("secret internal");
    expect(canViewContent(seller, 1, true)).toBe(true);
  });

  it("hides delisted listings from everyone but the owner", async () => {
    db.update(schema.listings).set({ status: "delisted" }).run();
    expect(await getListingDetail(db, { config, blobs }, rustLoop, buyer)).toBeNull();
    expect((await getListingDetail(db, { config, blobs }, rustLoop, seller))!.quotes).toBeNull();
  });
});
