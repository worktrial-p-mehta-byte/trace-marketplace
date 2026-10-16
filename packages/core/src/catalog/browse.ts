import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { schema, type Db } from "@tm/db";
import { comboKeyOf, FAILURE_CODES, labelName, type TraceTraits } from "@tm/enrich";
import { isEmptyCriteria, type DemandCriteria, type PriceQuote } from "@tm/pricing";
import { toSignalsOnly } from "@tm/scrub";
import type { LicenseScope, Trace } from "@tm/schema";
import type { PublicUser } from "../auth";
import type { EventBus } from "../events";
import type { BlobStore, SearchIndex } from "../ports";
import { BEHAVIOURS, parseIntent, type IntentChip, type ParsedIntent } from "../discovery/intent";
import { buildMarket, priceHistory, recordDemandSignal, runPricingConsumer } from "../pricing";

export type Outcome = "recovered" | "unresolved" | "tests_passed" | "clean";
export type SortKey = "relevance" | "price_desc" | "price_asc" | "newest" | "rarest";

export interface BrowseQuery {
  text?: string;
  /** Let free text match trace content; only for viewers allowed to read it (signed in). */
  includeContent?: boolean;
  /** A domain id from @tm/enrich ("medical", "data_querying", ...). */
  domain?: string;
  /** Authenticity level: consistent, well_formed or flagged. */
  authenticity?: string;
  language?: string;
  framework?: string;
  failure?: string;
  outcome?: Outcome;
  model?: string;
  tier?: 0 | 1;
  source?: "real" | "staged" | "synthetic";
  /** Shape properties a session must have (see BEHAVIOURS). */
  behaviours?: string[];
  /** Read facets out of the free text (default true). */
  parse?: boolean;
  /** Fold sessions with the same shape into one result with a "similar" count. */
  group?: boolean;
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
  /** Authenticity tiers 1–2; "unchecked" for listings from before the checks. */
  authenticity: string;
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
  /** How sure the labeler was of the domain. */
  domainConfidence: number;
  /** Failure label → the events that are its evidence. */
  evidence: Record<string, number[]>;
  /** Shape properties the session has (BEHAVIOURS keys). */
  behaviours: string[];
  /** Session shape fingerprint ("" when unknown). */
  shapeKey: string;
  /** Search only: why this result matched, most important first. */
  reasons?: string[];
  /** Search only: the relevance score results were ranked by. */
  score?: number;
  /** With grouping: how many other listings share this session's shape. */
  similar?: number;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface BrowseResult {
  total: number;
  items: CatalogItem[];
  /** What the free text was read as: chips that became filters, and the words left over. */
  intent?: ParsedIntent & {
    /** Chips not applied because an explicit filter already set that facet. */
    overridden: IntentChip[];
    /** True when the leftover words matched nothing and only ranked, not filtered. */
    restIgnored: boolean;
  };
  facets: Record<
    | "domain"
    | "authenticity"
    | "language"
    | "framework"
    | "failure"
    | "outcome"
    | "model"
    | "tier"
    | "source",
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
    case "authenticity":
      return [i.authenticity];
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
    ["authenticity", q.authenticity],
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
    .select({
      traceId: schema.labels.traceId,
      kind: schema.labels.kind,
      code: schema.labels.code,
      evidence: schema.labels.evidence,
    })
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
  const byTrace = new Map<string, typeof labels>();
  for (const l of labels) byTrace.set(l.traceId, [...(byTrace.get(l.traceId) ?? []), l]);
  return rows.map((r) => {
    const traits = r.traits as TraceTraits;
    const own = byTrace.get(r.traceId) ?? [];
    return {
      listingId: r.listingId,
      title: r.title,
      tier: r.tier,
      source: r.source,
      model: r.model,
      domain: traits.domain ?? "unknown",
      domains: traits.domains ?? [],
      authenticity: traits.authenticity?.level ?? "unchecked",
      language: r.language,
      framework: r.framework,
      turns: r.turns,
      priceCents: r.priceCents ?? 0,
      failures: own.filter((l) => failureCodes.has(l.code)).map((l) => l.code),
      evidence: Object.fromEntries(
        own
          .filter((l) => failureCodes.has(l.code))
          .map((l) => [l.code, (l.evidence as number[] | null) ?? []]),
      ),
      behaviours: behavioursOf(
        traits,
        own.map((l) => l.code),
      ),
      domainConfidence: traits.domainConfidence ?? 0,
      shapeKey: traits.shapeKey ?? "",
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

/** Which BEHAVIOURS a session shows, from its traits and labels. */
export function behavioursOf(t: TraceTraits, codes: string[]): string[] {
  const out: string[] = [];
  if ((t.repeatRatio ?? 0) >= 0.2) out.push("repeats");
  if ((t.distinctTools ?? 0) >= 4) out.push("many_tools");
  if (t.turns >= 100) out.push("long");
  if (t.turns < 15) out.push("short");
  if (codes.includes("context_compaction")) out.push("compaction");
  if (t.preferencePairs > 0) out.push("preference_pairs");
  return out;
}

const FACET_KEYS = [
  "domain",
  "language",
  "framework",
  "failure",
  "outcome",
  "authenticity",
] as const;

/**
 * Read facets out of the free text and merge them into the query. Filters
 * the buyer set explicitly win over what the text says.
 */
export function resolveQuery(q: BrowseQuery): {
  query: BrowseQuery;
  intent?: ParsedIntent;
  overridden: IntentChip[];
} {
  if (!q.text?.trim() || q.parse === false) return { query: q, overridden: [] };
  const intent = parseIntent(q.text);
  const query: BrowseQuery = { ...q, behaviours: [...(q.behaviours ?? [])] };
  const overridden: IntentChip[] = [];
  for (const c of intent.chips) {
    if (c.key === "behaviour") {
      if (!query.behaviours!.includes(c.value)) query.behaviours!.push(c.value);
    } else if (c.key === "tier") {
      if (query.tier === undefined) query.tier = c.value === "1" ? 1 : 0;
      else if (String(query.tier) !== c.value) overridden.push(c);
    } else if ((FACET_KEYS as readonly string[]).includes(c.key)) {
      const k = c.key as (typeof FACET_KEYS)[number];
      if (query[k] === undefined) (query as Record<string, unknown>)[k] = c.value;
      else if (query[k] !== c.value) overridden.push(c);
    }
  }
  return { query, intent, overridden };
}

/** Relevance and the reasons for it: the evidence behind each match, in words. */
function scoreItem(
  i: CatalogItem,
  q: BrowseQuery,
  lexical: number | undefined,
  rest: string,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (q.domain) {
    score += 1 + i.domainConfidence;
    reasons.push(
      `Domain: ${labelName("domain", q.domain)} (${Math.round(i.domainConfidence * 100)}% sure)`,
    );
  }
  if (q.failure) {
    const ev = i.evidence[q.failure] ?? [];
    score += 1 + 0.2 * Math.min(3, ev.length);
    reasons.push(
      `${labelName("failure", q.failure)}: ${ev.length} event${ev.length === 1 ? "" : "s"} of evidence${
        ev.length ? ` (${ev.slice(0, 3).join(", ")})` : ""
      }`,
    );
  }
  if (q.language || q.framework) {
    score += 0.5;
    reasons.push(`Stack: ${[i.language, i.framework].filter(Boolean).join(" / ")}`);
  }
  if (q.tier !== undefined) {
    score += 0.3;
    reasons.push(
      i.tier === 1
        ? "Signals only: the session's shape, no content"
        : "Open source: full scrubbed content",
    );
  }
  for (const b of q.behaviours ?? []) {
    score += 0.6;
    reasons.push(BEHAVIOURS[b]?.name ?? b);
  }
  if (i.outcomes.includes("recovered")) {
    score += 0.4;
    reasons.push(
      i.outcomes.includes("tests_passed") ? "Recovered, and tests pass at the end" : "Recovered",
    );
  } else if (q.outcome) {
    reasons.push(`Outcome: ${q.outcome.replace(/_/g, " ")}`);
  }
  if (i.authenticity === "consistent") {
    score += 0.3;
    reasons.push("Authenticity: consistent");
  } else if (i.authenticity === "flagged") {
    score -= 1;
    reasons.push("Authenticity: flagged");
  }
  if (lexical !== undefined) {
    score += 2 * lexical;
    reasons.unshift(`Matches “${rest}”`);
  }
  return { score, reasons };
}

/**
 * Search and filter the catalog. Free text is read for facets first (the
 * intent parser), which become hard filters; leftover words are matched
 * lexically. Facet counts for each dimension ignore that dimension's own
 * filter, so a buyer can see what switching it would give.
 */
export async function browseCatalog(
  db: Db,
  deps: { config: MarketplaceConfig; search: SearchIndex },
  input: BrowseQuery,
): Promise<BrowseResult> {
  const { query: q, intent, overridden } = resolveQuery(input);
  let items = loadCatalog(db, deps.config);
  const rest = intent ? intent.rest : (q.text?.trim() ?? "");
  let lexical: Map<string, number> | undefined;
  let restIgnored = false;
  if (rest) {
    const { ids } = await deps.search.search({
      text: rest,
      includeContent: q.includeContent === true,
    });
    lexical = new Map(ids.map((id, n) => [id, 1 - n / Math.max(1, ids.length)]));
    const chips = intent?.chips.length ?? 0;
    // Words alone filter. With facets recognised, words only rank, so text
    // similarity never overrides (or empties) what the facets asked for.
    if (!chips) items = items.filter((i) => lexical!.has(i.listingId));
    else restIgnored = !items.some((i) => lexical!.has(i.listingId));
  }
  const behaviours = q.behaviours ?? [];
  if (behaviours.length)
    items = items.filter((i) => behaviours.every((b) => i.behaviours.includes(b)));
  const facets = {
    domain: facet(items, q, "domain"),
    authenticity: facet(items, q, "authenticity"),
    language: facet(items, q, "language"),
    framework: facet(items, q, "framework"),
    failure: facet(items, q, "failure"),
    outcome: facet(items, q, "outcome"),
    model: facet(items, q, "model"),
    tier: facet(items, q, "tier"),
    source: facet(items, q, "source"),
  };
  let filtered = items.filter((i) => matches(i, q));
  const searching = Boolean(q.text?.trim());
  if (searching) {
    for (const i of filtered) {
      const s = scoreItem(i, q, lexical?.get(i.listingId), rest);
      i.score = Math.round(s.score * 100) / 100;
      i.reasons = s.reasons;
    }
  }
  const sort: SortKey = q.sort ?? (searching ? "relevance" : "price_desc");
  const cmp: Record<SortKey, (a: CatalogItem, b: CatalogItem) => number> = {
    relevance: (a, b) => (b.score ?? 0) - (a.score ?? 0) || b.priceCents - a.priceCents,
    price_desc: (a, b) => b.priceCents - a.priceCents,
    price_asc: (a, b) => a.priceCents - b.priceCents,
    newest: (a, b) => b.sharedAt.getTime() - a.sharedAt.getTime(),
    rarest: (a, b) => b.rarity - a.rarity || b.priceCents - a.priceCents,
  };
  filtered.sort(cmp[sort]);
  if (q.group) {
    // Keep the best-ranked listing of each shape; the rest count as similar.
    const first = new Map<string, CatalogItem>();
    const kept: CatalogItem[] = [];
    for (const i of filtered) {
      const lead = i.shapeKey ? first.get(i.shapeKey) : undefined;
      if (lead) lead.similar = (lead.similar ?? 0) + 1;
      else {
        if (i.shapeKey) first.set(i.shapeKey, i);
        kept.push(i);
      }
    }
    filtered = kept;
  }
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 24;
  return {
    total: filtered.length,
    items: filtered.slice(offset, offset + limit),
    facets,
    intent: intent ? { ...intent, overridden, restIgnored } : undefined,
  };
}

/** Criteria a buyer's filters express, for demand signals. Empty when nothing specific was asked. */
export function criteriaOf(input: BrowseQuery): DemandCriteria {
  // What the text was read as counts too: "medical retry loops" is demand
  // for medical retry loops, as if the buyer had clicked both filters.
  const q = resolveQuery(input).query;
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
