import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { sellerShareFor, type MarketplaceConfig } from "@tm/config";
import { newId, schema, type Db } from "@tm/db";
import {
  comboKeyOf,
  DOMAIN_IDS,
  enrichTrace,
  type DomainId,
  type DomainScore,
  type TraceTraits,
} from "@tm/enrich";
import { median, splitSale, type PriceQuote } from "@tm/pricing";
import { placeholderDensity, scrubTrace, toSignalsOnly } from "@tm/scrub";
import { Trace, type Label, type Tier } from "@tm/schema";
import { TERMS_VERSION } from "../auth";
import { EventTypes, type EventBus } from "../events";
import { isTierSupported } from "../policy";
import type { BlobStore, SearchIndex } from "../ports";
import { runSearchConsumer } from "../search";
import { buildMarket, runPricingConsumer } from "../pricing";

export class ShareError extends Error {}

/** The seller already shared this exact session. */
export class DuplicateShareError extends ShareError {
  constructor() {
    super("You have already shared this session.");
  }
}

/**
 * Identity of a stored trace's content, for duplicate shares and for rarity
 * (copies don't create scarcity). It covers the trace id, which the adapter
 * derives from the harness session id, as well as the events: signals-only
 * traces have their text stripped, so two different sessions with the same
 * shape (same steps, tools and timing) have identical events, and hashing
 * events alone refused the second as "already shared".
 */
/**
 * Identity of a trace's content for duplicate detection and rarity.
 *
 * Open source (tier 0): the events alone. The content is what buyers get
 * and the server verifies it, so a re-upload under a different trace id is
 * still the same trace.
 *
 * Signals only (tier 1): the stripped events plus the trace id. With the
 * text gone, two different sessions of the same shape are byte-identical,
 * so the id (derived from the harness session id) tells them apart. The id
 * is client-supplied, so a seller could relist one shape under new ids;
 * such copies are priced as near-duplicates and carry the lowest base price.
 */
export function contentHashOf(trace: Pick<Trace, "id" | "events">, tier: Tier): string {
  const subject = tier === 1 ? { id: trace.id, events: trace.events } : trace.events;
  return createHash("sha256").update(JSON.stringify(subject)).digest("hex");
}

/** The events-only hash, which signals-only rows written by older versions still carry. */
export function legacyContentHashOf(trace: Pick<Trace, "events">): string {
  return createHash("sha256").update(JSON.stringify(trace.events)).digest("hex");
}

/**
 * Rewrite a seller's signals-only rows that still carry the events-only hash
 * to the current format, each from its own stored trace. Runs before a
 * duplicate check that could meet such a row, so a different session with
 * the same shape is never mistaken for it, and the same session still is.
 */
async function upgradeLegacyHashes(
  db: Db,
  blobs: BlobStore,
  sellerId: string,
  legacyHash: string,
): Promise<void> {
  const rows = db
    .select({ id: schema.traces.id, blobKey: schema.traces.blobKey })
    .from(schema.traces)
    .innerJoin(schema.consents, eq(schema.consents.traceId, schema.traces.id))
    .where(
      and(
        eq(schema.traces.sellerId, sellerId),
        eq(schema.traces.contentHash, legacyHash),
        eq(schema.consents.tier, 1),
      ),
    )
    .all();
  for (const row of rows) {
    const raw = await blobs.get(row.blobKey);
    if (!raw) continue; // nothing to verify against; leave it as it is
    const stored = Trace.safeParse(JSON.parse(raw));
    if (!stored.success) continue;
    db.update(schema.traces)
      .set({ contentHash: contentHashOf(stored.data, 1) })
      .where(eq(schema.traces.id, row.id))
      .run();
  }
}

export interface CatalogDeps {
  config: MarketplaceConfig;
  bus: EventBus;
  blobs: BlobStore;
  /** When given, the search index is updated right after the change. */
  search?: SearchIndex;
  now?: Date;
}

/** Traits a signals-only (tier 1) upload reports from the seller's browser. */
export type ClientTraits = Partial<
  Pick<
    TraceTraits,
    | "userCorrections"
    | "preferencePairs"
    | "testsRanAtEnd"
    | "testsPassedAtEnd"
    | "recovered"
    | "hadFailure"
    | "failureCategory"
    | "language"
    | "framework"
    | "redactionDensity"
    | "domain"
    | "domainConfidence"
    | "domains"
    | "repeatRatio"
  >
>;

const KNOWN_DOMAINS = new Set<string>(DOMAIN_IDS);
const unit = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

/**
 * The domain a signals-only upload claims. The server can't see the text it
 * was detected from, so it is kept as a claim: a known id, confidence and
 * shares clamped to 0..1, at most three domains.
 */
function claimedDomain(
  client: ClientTraits,
): Pick<TraceTraits, "domain" | "domainConfidence" | "domains"> {
  const domain: DomainId =
    client.domain && KNOWN_DOMAINS.has(client.domain) ? client.domain : "unknown";
  const domains: DomainScore[] = (Array.isArray(client.domains) ? client.domains : [])
    .filter((d) => d && typeof d === "object" && KNOWN_DOMAINS.has(String(d.domain)))
    .slice(0, 3)
    .map((d) => ({ domain: d.domain, share: unit(d.share) }));
  return {
    domain,
    domainConfidence: domain === "unknown" ? 0 : unit(client.domainConfidence),
    domains,
  };
}

/**
 * For signals-only uploads the server can't see text, so a few traits come
 * from the seller's browser. Structure-derived traits (turns, tool calls,
 * errors, interrupts) are recomputed here; reported ones are bounded by them.
 */
function mergeSignalsTraits(server: TraceTraits, client: ClientTraits): TraceTraits {
  const userMessages = server.turns; // upper bound
  const corrections = Math.min(Math.max(0, client.userCorrections ?? 0), userMessages);
  const pairs = Math.min(Math.max(0, client.preferencePairs ?? 0), corrections + server.toolErrors);
  const hadFailure = server.hadFailure || corrections > 0;
  return {
    ...server,
    userCorrections: corrections,
    preferencePairs: pairs,
    hadFailure,
    recovered: hadFailure && Boolean(client.recovered),
    testsRanAtEnd: Boolean(client.testsRanAtEnd),
    testsPassedAtEnd: Boolean(client.testsRanAtEnd && client.testsPassedAtEnd),
    failureCategory: client.failureCategory ?? server.failureCategory,
    language: client.language ?? server.language,
    framework: client.framework ?? server.framework,
    redactionDensity: Math.min(1, Math.max(0, client.redactionDensity ?? 0)),
    // Without inputs every call to a tool looks like a repeat, so the
    // server's count is an upper bound; the browser's count can only lower it.
    repeatRatio:
      client.repeatRatio === undefined
        ? server.repeatRatio
        : Math.min(server.repeatRatio, unit(client.repeatRatio)),
    ...claimedDomain(client),
  };
}

export interface ShareInput {
  sellerId: string;
  trace: unknown;
  tier: number;
  /** Only used for tier 1, where the server cannot see content. */
  clientTraits?: ClientTraits;
  clientLabels?: Label[];
}

export interface ShareResult {
  traceId: string;
  listingId: string;
  priceCents: number;
  sellerCents: number;
  labels: string[];
  /** True when the upload succeeded but pricing hasn't run yet; it will on the next consumer run. */
  pricePending?: boolean;
}

/**
 * Accept a trace the seller approved in their browser. The server never
 * trusts the upload: it validates the schema, scrubs again, strips content
 * for signals-only, recomputes labels and traits, checks eligibility and
 * duplicates, then stores, lists and prices it.
 */
/** Options for trusted, server-side callers only (seed script, market simulator). Never exposed over HTTP. */
export interface InternalShareOptions {
  /** Accept provenance.source = "synthetic". */
  allowSynthetic?: boolean;
  /** Skip repricing and indexing; the caller runs them once after a batch. */
  deferMarket?: boolean;
}

export async function shareTrace(
  db: Db,
  deps: CatalogDeps,
  input: ShareInput,
  internal: InternalShareOptions = {},
): Promise<ShareResult> {
  const now = deps.now ?? new Date();
  const parsed = Trace.safeParse(input.trace);
  if (!parsed.success) throw new ShareError("The upload is not a valid trace.");
  if (!isTierSupported(input.tier)) throw new ShareError("Choose open source or signals only.");
  const tier = input.tier as Tier;
  if (parsed.data.provenance.source === "synthetic" && !internal.allowSynthetic) {
    throw new ShareError("Synthetic traces can only be added by the seed script.");
  }

  const seller = db.select().from(schema.users).where(eq(schema.users.id, input.sellerId)).get();
  if (!seller) throw new ShareError("Sign in to share traces.");
  if (seller.termsAcceptedVersion !== TERMS_VERSION) {
    throw new ShareError("Accept the data terms before sharing.");
  }

  // Defense in depth: scrub again server-side, then strip content for tier 1.
  const scrubbed = scrubTrace(parsed.data).trace;
  const stored = tier === 1 ? toSignalsOnly(scrubbed) : scrubbed;

  let labels: Label[];
  let traits: TraceTraits;
  if (tier === 0) {
    const e = enrichTrace(stored, { redactionDensity: placeholderDensity(stored) });
    labels = e.labels;
    traits = e.traits;
  } else {
    const e = enrichTrace(stored);
    traits = mergeSignalsTraits(e.traits, input.clientTraits ?? {});
    labels = (input.clientLabels ?? e.labels).filter((l) => l.source === "heuristic");
  }
  const comboKey = comboKeyOf(traits);

  if (labels.some((l) => l.code === "no_model_output") || traits.turns === 0) {
    throw new ShareError(
      "This session has no replies from the model, so there is nothing to share.",
    );
  }

  const contentHash = contentHashOf(stored, tier);
  // Signals-only rows from before the id joined the hash are upgraded first,
  // each from its own stored trace, so the check below sees one format.
  if (tier === 1) {
    await upgradeLegacyHashes(db, deps.blobs, input.sellerId, legacyContentHashOf(stored));
  }
  /** Same seller, same content, consent not revoked. */
  const findDuplicate = (q: Db) =>
    q
      .select({ id: schema.traces.id })
      .from(schema.traces)
      .innerJoin(schema.consents, eq(schema.consents.traceId, schema.traces.id))
      .where(
        and(
          eq(schema.traces.sellerId, input.sellerId),
          eq(schema.traces.contentHash, contentHash),
          isNull(schema.consents.revokedAt),
        ),
      )
      .get();
  // Fast path: refuse before writing anything.
  if (findDuplicate(db)) throw new DuplicateShareError();

  const traceId = newId("trc");
  const assetId = newId("ast");
  const listingId = newId("lst");
  const blobKey = `traces/${traceId}.json`;
  await deps.blobs.put(blobKey, JSON.stringify(stored));

  try {
    // The duplicate check is repeated inside the insert transaction: other
    // uploads may have run during the await above. better-sqlite3 runs the
    // transaction synchronously, so check and insert are atomic here.
    // (Postgres will also need a partial unique index: see LIMITATIONS.md.)
    db.transaction((tx) => {
      if (findDuplicate(tx as unknown as Db)) {
        throw new DuplicateShareError();
      }
      tx.insert(schema.traces)
        .values({
          id: traceId,
          sellerId: input.sellerId,
          schemaVersion: stored.schemaVersion,
          source: stored.provenance.source,
          title: stored.title,
          harness: stored.provenance.harness.name,
          model: stored.provenance.model.id,
          language: traits.language,
          framework: traits.framework,
          startedAt: new Date(stored.startedAt),
          endedAt: new Date(stored.endedAt),
          turnCount: traits.turns,
          toolCallCount: traits.toolCalls,
          contentHash,
          blobKey,
          redactionCount: 0,
          redactionDensity: traits.redactionDensity,
          createdAt: now,
        })
        .run();
      tx.insert(schema.consents)
        .values({
          id: newId("cns"),
          traceId,
          sellerId: input.sellerId,
          tier,
          scope: "session",
          termsVersion: TERMS_VERSION,
          grantedAt: now,
        })
        .run();
      tx.insert(schema.assets)
        .values({ id: assetId, traceId, kind: tier === 0 ? "scrubbed_trace" : "signals", blobKey })
        .run();
      for (const l of labels) {
        tx.insert(schema.labels)
          .values({
            id: newId("lbl"),
            traceId,
            kind: l.kind,
            code: l.code,
            confidence: l.confidence,
            source: l.source,
            evidence: l.evidence,
          })
          .run();
      }
      tx.insert(schema.traceTraits)
        .values({ traceId, data: traits, comboKey, createdAt: now })
        .run();
      tx.insert(schema.listings)
        .values({
          id: listingId,
          assetId,
          traceId,
          tier,
          status: "active",
          allowedLicenses: ["research", "eval", "training"],
          createdAt: now,
        })
        .run();
      // Outbox events commit with the listing (same SQLite connection), so
      // pricing and search can always catch up later, even if they fail now.
      deps.bus.emit(EventTypes.TraceIngested, { traceId, sellerId: input.sellerId });
      deps.bus.emit(EventTypes.ListingCreated, { listingId, traceId });
    });
  } catch (err) {
    await deps.blobs.delete(blobKey);
    throw err;
  }

  // The upload is committed. Pricing and indexing are downstream work: a
  // failure there must not turn a successful share into an error the seller
  // can't retry (a retry would hit the duplicate check). The events above
  // stay in the outbox, so the next consumer run picks them up.
  if (!internal.deferMarket) {
    try {
      runPricingConsumer(db, deps.bus, { config: deps.config, now });
    } catch (err) {
      console.error("Pricing after share failed; will retry on the next run", err);
    }
    try {
      if (deps.search) await runSearchConsumer(db, deps.bus, deps.blobs, deps.search);
    } catch (err) {
      console.error("Search indexing after share failed; will retry on the next run", err);
    }
  }

  const listed = db.select().from(schema.listings).where(eq(schema.listings.id, listingId)).get()!
    .currentPriceCents;
  const priceCents = listed ?? 0;
  return {
    traceId,
    listingId,
    priceCents,
    sellerCents: splitSale(priceCents, sellerShareFor(deps.config, traits.domain)).seller,
    labels: labels.map((l) => l.code),
    ...(listed === null && !internal.deferMarket ? { pricePending: true } : {}),
  };
}

/**
 * Withdraw consent: the listing leaves the catalog and nothing new is sold.
 * Past sales stand (the consent ledger keeps both dates).
 */
export async function revokeTrace(
  db: Db,
  deps: Omit<CatalogDeps, "blobs"> & { blobs?: BlobStore },
  sellerId: string,
  traceId: string,
): Promise<void> {
  const now = deps.now ?? new Date();
  const trace = db.select().from(schema.traces).where(eq(schema.traces.id, traceId)).get();
  if (!trace || trace.sellerId !== sellerId) throw new ShareError("Trace not found.");
  db.transaction((tx) => {
    tx.update(schema.consents)
      .set({ revokedAt: now })
      .where(and(eq(schema.consents.traceId, traceId), isNull(schema.consents.revokedAt)))
      .run();
    tx.update(schema.listings)
      .set({ status: "delisted" })
      .where(eq(schema.listings.traceId, traceId))
      .run();
  });
  deps.bus.emit(EventTypes.ConsentRevoked, { traceId });
  deps.bus.emit(EventTypes.ListingDelisted, { traceId });
  runPricingConsumer(db, deps.bus, { config: deps.config, now });
  if (deps.search && deps.blobs) await runSearchConsumer(db, deps.bus, deps.blobs, deps.search);
}

export interface SellerTraceRow {
  traceId: string;
  listingId: string;
  title: string | null;
  tier: number;
  status: "active" | "delisted";
  priceCents: number | null;
  sellerCents: number | null;
  model: string;
  language: string | null;
  turns: number;
  labels: string[];
  startedAt: Date;
  sharedAt: Date;
  revokedAt: Date | null;
}

export function listSellerTraces(
  db: Db,
  sellerId: string,
  config: MarketplaceConfig,
): SellerTraceRow[] {
  const rows = db
    .select({
      traceId: schema.traces.id,
      listingId: schema.listings.id,
      title: schema.traces.title,
      tier: schema.listings.tier,
      status: schema.listings.status,
      priceCents: schema.listings.currentPriceCents,
      model: schema.traces.model,
      language: schema.traces.language,
      turns: schema.traces.turnCount,
      startedAt: schema.traces.startedAt,
      sharedAt: schema.traces.createdAt,
      revokedAt: schema.consents.revokedAt,
    })
    .from(schema.traces)
    .innerJoin(schema.listings, eq(schema.listings.traceId, schema.traces.id))
    .innerJoin(schema.consents, eq(schema.consents.traceId, schema.traces.id))
    .where(eq(schema.traces.sellerId, sellerId))
    .orderBy(desc(schema.traces.createdAt))
    .all();
  const labelRows = db
    .select({ traceId: schema.labels.traceId, code: schema.labels.code, kind: schema.labels.kind })
    .from(schema.labels)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.labels.traceId))
    .where(eq(schema.traces.sellerId, sellerId))
    .all();
  return rows.map((r) => ({
    ...r,
    sellerCents:
      r.priceCents === null
        ? null
        : splitSale(
            r.priceCents,
            sellerShareFor(
              config,
              labelRows.find((l) => l.traceId === r.traceId && l.kind === "domain")?.code,
            ),
          ).seller,
    labels: labelRows
      .filter((l) => l.traceId === r.traceId && l.kind === "failure" && l.code !== "harness_error")
      .map((l) => l.code),
  }));
}

/**
 * Price a trace that is not listed yet (the seller's review screen). Only
 * traits are sent to the server, never content.
 */
export function estimatePrice(
  db: Db,
  deps: { config: MarketplaceConfig; now?: Date },
  traits: TraceTraits,
  tier: Tier,
  opts: {
    sellerId?: string;
    /** Other sessions of the same shape in the same upload batch (near-duplicates to be). */
    pendingSameShape?: number;
  } = {},
): PriceQuote {
  const market = buildMarket(db, deps);
  const comboKey = comboKeyOf(traits);
  // Price the market as it will be once this trace is listed: its own
  // combination gains one, and the median is taken over the new counts, the
  // same way repricing will see it straight after the upload.
  const after = new Map(market.comboCounts);
  const comboCount = (after.get(comboKey) ?? 0) + 1;
  after.set(comboKey, comboCount);
  const medianComboCount = median([...after.values()]);
  return market.policy.price({
    traits,
    tier,
    license: "research",
    config: deps.config.pricing,
    market: {
      comboCount,
      medianComboCount,
      demandPressure: market.pressureFor(traits),
      now: market.now,
      v2: market.contextFor(traits, {
        sellerId: opts.sellerId,
        tier,
        pendingSameShape: opts.pendingSameShape,
      }),
    },
  });
}

export * from "./browse";
