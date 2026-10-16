import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { schema, type Db } from "@tm/db";
import { comboKeyOf, FAILURE_CODES, type TraceTraits } from "@tm/enrich";
import { isEmptyCriteria, type DemandCriteria, type PriceQuote } from "@tm/pricing";
import { toSignalsOnly } from "@tm/scrub";
import type { LicenseScope, Trace } from "@tm/schema";
import type { PublicUser } from "../auth";
import type { EventBus } from "../events";
import type { BlobStore, SearchIndex } from "../ports";
import { buildMarket, priceHistory, recordDemandSignal, runPricingConsumer } from "../pricing";

export type Outcome = "recovered" | "unresolved" | "tests_passed" | "clean";
export type SortKey = "relevance" | "price_desc" | "price_asc" | "newest" | "rarest";

export interface BrowseQuery {
  text?: string;
  /** Let free text match trace content; only for viewers allowed to read it (signed in). */
  includeContent?: boolean;
  /** A domain id from @tm/enrich ("medical", "data_querying", ...). */
  domain?: string;
  language?: string;
  framework?: string;
  failure?: string;
  outcome?: Outcome;
  model?: string;
  tier?: 0 | 1;
  source?: "real" | "staged" | "synthetic";
  sort?: SortKey;
  limit?: number;
  offset?: number;
}

export interface CatalogItem {
  listingId: string;
  title: string | null;
  tier: number;
  source: "real" | "staged" | "synthetic";
  model: string;
  /** What the session was about; "unknown" when the labeler could not tell. */
  domain: string;
  /** Share of evidence per domain, top three (a session can span domains). */
  domains: { domain: string; share: number }[];
  language: string | null;
  framework: string | null;
  turns: number;
  priceCents: number;
  failures: string[];
  outcomes: Outcome[];
  failureCategory?: string;
  rarity: number;
  sharedAt: Date;
  startedAt: Date;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface BrowseResult {
  total: number;
  items: CatalogItem[];
  facets: Record<
    "domain" | "language" | "framework" | "failure" | "outcome" | "model" | "tier" | "source",
    FacetValue[]
  >;
}

export function outcomesOf(t: TraceTraits): Outcome[] {
  const out: Outcome[] = [];
  if (t.recovered) out.push("recovered");
  else if (t.hadFailure) out.push("unresolved");
  if (t.testsPassedAtEnd) out.push("tests_passed");
  if (!t.hadFailure) out.push("clean");
  return out;
}

type Dim = keyof BrowseResult["facets"];

function dimValues(i: CatalogItem, d: Dim): string[] {
  switch (d) {
    case "domain":
      return [i.domain];
    case "language":
      return i.language ? [i.language] : [];
    case "framework":
      return i.framework ? [i.framework] : [];
    case "failure":
      return i.failures;
    case "outcome":
      return i.outcomes;
    case "model":
      return [i.model];
    case "tier":
      return [String(i.tier)];
    case "source":
      return [i.source];
  }
}

function matches(i: CatalogItem, q: BrowseQuery, skip?: Dim): boolean {
  const want: [Dim, string | undefined][] = [
    ["domain", q.domain],
    ["language", q.language],
    ["framework", q.framework],
    ["failure", q.failure],
    ["outcome", q.outcome],
    ["model", q.model],
    ["tier", q.tier === undefined ? undefined : String(q.tier)],
    ["source", q.source],
  ];
  return want.every(([d, v]) => d === skip || v === undefined || dimValues(i, d).includes(v));
}

/** All active listings with what the catalog shows and filters on. */
function loadCatalog(db: Db, config: MarketplaceConfig): CatalogItem[] {
  const rows = db
    .select({
      listingId: schema.listings.id,
      traceId: schema.traces.id,
      title: schema.traces.title,
      tier: schema.listings.tier,
      source: schema.traces.source,
      model: schema.traces.model,
      language: schema.traces.language,
      framework: schema.traces.framework,
      turns: schema.traces.turnCount,
      priceCents: schema.listings.currentPriceCents,
      traits: schema.traceTraits.data,
      sharedAt: schema.traces.createdAt,
      startedAt: schema.traces.startedAt,
    })
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.traces.id))
    .where(eq(schema.listings.status, "active"))
    .all();
  if (!rows.length) return [];
  const labels = db
    .select({ traceId: schema.labels.traceId, code: schema.labels.code })
    .from(schema.labels)
    .where(
      inArray(
        schema.labels.traceId,
        rows.map((r) => r.traceId),
      ),
    )
    .all();
  const failureCodes = new Set<string>(FAILURE_CODES);
  const market = buildMarket(db, { config });
  const rarityOf = new Map(
    market.policy.name === "trait-v2"
      ? market.active.map((a) => [a.listingId, market.quote(a).factors.rarity])
      : [],
  );
  return rows.map((r) => {
    const traits = r.traits as TraceTraits;
    return {
      listingId: r.listingId,
      title: r.title,
      tier: r.tier,
      source: r.source,
      model: r.model,
      domain: traits.domain ?? "unknown",
      domains: traits.domains ?? [],
      language: r.language,
      framework: r.framework,
      turns: r.turns,
      priceCents: r.priceCents ?? 0,
      failures: labels
        .filter((l) => l.traceId === r.traceId && failureCodes.has(l.code))
        .map((l) => l.code),
      outcomes: outcomesOf(traits),
      failureCategory: traits.failureCategory,
      // The rarity the active policy prices with (V2: domain-first cohorts).
      rarity:
        rarityOf.get(r.listingId) ??
        market.medianComboCount / Math.max(1, market.comboCounts.get(comboKeyOf(traits)) ?? 1),
      sharedAt: r.sharedAt,
      startedAt: r.startedAt,
    };
  });
}

function facet(items: CatalogItem[], q: BrowseQuery, d: Dim): FacetValue[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (!matches(i, q, d)) continue;
    for (const v of new Set(dimValues(i, d))) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Search and filter the catalog. Facet counts for each dimension ignore that
 * dimension's own filter, so a buyer can see what switching it would give.
 */
export async function browseCatalog(
  db: Db,
  deps: { config: MarketplaceConfig; search: SearchIndex },
  q: BrowseQuery,
): Promise<BrowseResult> {
  let items = loadCatalog(db, deps.config);
  let rank: Map<string, number> | undefined;
  if (q.text?.trim()) {
    const { ids } = await deps.search.search({
      text: q.text,
      includeContent: q.includeContent === true,
    });
    rank = new Map(ids.map((id, i) => [id, i]));
    items = items.filter((i) => rank!.has(i.listingId));
  }
  const facets = {
    domain: facet(items, q, "domain"),
    language: facet(items, q, "language"),
    framework: facet(items, q, "framework"),
    failure: facet(items, q, "failure"),
    outcome: facet(items, q, "outcome"),
    model: facet(items, q, "model"),
    tier: facet(items, q, "tier"),
    source: facet(items, q, "source"),
  };
  const filtered = items.filter((i) => matches(i, q));
  const sort: SortKey = q.sort ?? (rank ? "relevance" : "price_desc");
  const cmp: Record<SortKey, (a: CatalogItem, b: CatalogItem) => number> = {
    relevance: (a, b) => (rank?.get(a.listingId) ?? 0) - (rank?.get(b.listingId) ?? 0),
    price_desc: (a, b) => b.priceCents - a.priceCents,
    price_asc: (a, b) => a.priceCents - b.priceCents,
    newest: (a, b) => b.sharedAt.getTime() - a.sharedAt.getTime(),
    rarest: (a, b) => b.rarity - a.rarity || b.priceCents - a.priceCents,
  };
  filtered.sort(cmp[sort]);
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 24;
  return { total: filtered.length, items: filtered.slice(offset, offset + limit), facets };
}

/** Criteria a buyer's filters express, for demand signals. Empty when nothing specific was asked. */
export function criteriaOf(q: BrowseQuery): DemandCriteria {
  const c: DemandCriteria = {};
  if (q.domain) c.domain = q.domain;
  if (q.language) c.language = q.language;
  if (q.framework) c.framework = q.framework;
  if (q.failure) c.failure = q.failure;
  if (q.model) c.model = q.model;
  return c;
}

/**
 * Record a buyer's search or view as demand and reprice. Only buyers count,
 * and only when they asked for something specific.
 */
export function recordBuyerInterest(
  db: Db,
  deps: { config: MarketplaceConfig; bus: EventBus },
  viewer: PublicUser | undefined,
  kind: "search" | "view",
  criteria: DemandCriteria,
): boolean {
  if (!viewer?.buyerOrgId) return false;
  if (isEmptyCriteria(criteria)) return false;
  recordDemandSignal(db, deps.bus, {
    kind,
    criteria,
    weight: deps.config.pricing.demand.signalWeights[kind],
    buyerOrgId: viewer.buyerOrgId,
  });
  runPricingConsumer(db, deps.bus, { config: deps.config });
  return true;
}

/** Short stable alias so buyers can tell sellers apart without identifying them. */
export function sellerAlias(sellerId: string): string {
  return `Seller ${createHash("sha256").update(sellerId).digest("hex").slice(0, 6)}`;
}

export interface ListingDetail {
  listingId: string;
  traceId: string;
  title: string | null;
  tier: number;
  status: "active" | "delisted";
  source: "real" | "staged" | "synthetic";
  model: string;
  harness: string;
  language: string | null;
  framework: string | null;
  startedAt: Date;
  endedAt: Date;
  sellerAlias: string;
  isOwner: boolean;
  traits: TraceTraits;
  labels: { kind: string; code: string; evidence: number[] }[];
  quotes: Record<LicenseScope, PriceQuote> | null;
  history: { priceCents: number; reason: string; createdAt: Date }[];
  /** Content visible to this viewer: full scrubbed trace, or structure only. */
  trace: Trace | null;
  contentVisible: boolean;
}

/**
 * Content policy for v0: the owner always sees their trace; for open-source
 * (tier 0) listings, any signed-in user sees the scrubbed content (buying is
 * a license to use it); signals-only listings never had content.
 */
export function canViewContent(viewer: PublicUser | undefined, tier: number, isOwner: boolean) {
  return isOwner || (tier === 0 && viewer !== undefined);
}

export async function getListingDetail(
  db: Db,
  deps: { config: MarketplaceConfig; blobs: BlobStore },
  listingId: string,
  viewer?: PublicUser,
): Promise<ListingDetail | null> {
  const row = db
    .select()
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.traces.id))
    .where(eq(schema.listings.id, listingId))
    .get();
  if (!row) return null;
  const isOwner = viewer?.id === row.traces.sellerId;
  if (row.listings.status !== "active" && !isOwner) return null;

  const labels = db
    .select({
      kind: schema.labels.kind,
      code: schema.labels.code,
      evidence: schema.labels.evidence,
    })
    .from(schema.labels)
    .where(eq(schema.labels.traceId, row.traces.id))
    .all()
    .map((l) => ({ ...l, evidence: (l.evidence as number[] | null) ?? [] }));

  let quotes: ListingDetail["quotes"] = null;
  if (row.listings.status === "active") {
    const market = buildMarket(db, { config: deps.config });
    const active = market.active.find((a) => a.listingId === listingId);
    if (active) {
      quotes = {
        research: market.quote(active, "research"),
        eval: market.quote(active, "eval"),
        training: market.quote(active, "training"),
      };
    }
  }

  const raw = await deps.blobs.get(row.traces.blobKey);
  const contentVisible = canViewContent(viewer, row.listings.tier, isOwner);
  return {
    listingId,
    traceId: row.traces.id,
    title: row.traces.title,
    tier: row.listings.tier,
    status: row.listings.status,
    source: row.traces.source,
    model: row.traces.model,
    harness: row.traces.harness,
    language: row.traces.language,
    framework: row.traces.framework,
    startedAt: row.traces.startedAt,
    endedAt: row.traces.endedAt,
    sellerAlias: sellerAlias(row.traces.sellerId),
    isOwner,
    traits: row.trace_traits.data as TraceTraits,
    labels,
    quotes,
    history: priceHistory(db, listingId),
    // Content the viewer may not see never leaves this function.
    trace: raw
      ? contentVisible
        ? (JSON.parse(raw) as Trace)
        : toSignalsOnly(JSON.parse(raw) as Trace)
      : null,
    contentVisible,
  };
}

/**
 * Just the title of a listing that's for sale, for page metadata. Cheap (one
 * indexed query), and nothing for withdrawn listings, whose page is a 404
 * for everyone but the seller.
 */
export function listingTitle(db: Db, listingId: string): string | undefined {
  const row = db
    .select({ title: schema.traces.title, status: schema.listings.status })
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.listings.id, listingId))
    .get();
  return row?.status === "active" ? (row.title ?? undefined) : undefined;
}
