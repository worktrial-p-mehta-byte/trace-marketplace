import { eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@tm/db";
import { labelName, type LabelKindId } from "@tm/enrich";
import type { Trace } from "@tm/schema";
import { EventTypes, type EventBus } from "../events";
import type { BlobStore, SearchIndex, SearchQuery } from "../ports";

const MAX_BODY_CHARS = 20_000;

/** Turn free text into a safe FTS5 query: each word becomes a quoted prefix term (AND). */
export function toFtsQuery(text: string): string | null {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length > 0)
    .slice(0, 12);
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : null;
}

/** v0 SearchIndex: SQLite FTS5 table `listing_search`, ranked by bm25. */
export function createSqliteSearchIndex(db: Db): SearchIndex {
  const del = db.$client.prepare("DELETE FROM listing_search WHERE listing_id = ?");
  const ins = db.$client.prepare(
    "INSERT INTO listing_search (listing_id, title, meta, content) VALUES (?, ?, ?, ?)",
  );
  const find = db.$client.prepare(
    "SELECT listing_id FROM listing_search WHERE listing_search MATCH ? ORDER BY bm25(listing_search, 0, 3.0, 1.0, 1.0) LIMIT ?",
  );
  return {
    async index(listingId, doc) {
      db.$client.transaction(() => {
        del.run(listingId);
        ins.run(
          listingId,
          String(doc.title ?? ""),
          String(doc.meta ?? ""),
          String(doc.content ?? ""),
        );
      })();
    },
    async remove(listingId) {
      del.run(listingId);
    },
    async search(q: SearchQuery) {
      const terms = q.text ? toFtsQuery(q.text) : null;
      if (!terms) return { ids: [], total: 0 };
      // Without content access, every term must match in title or metadata.
      const fts = q.includeContent ? terms : `{title meta} : (${terms})`;
      const rows = find.all(fts, q.limit ?? 10_000) as { listing_id: string }[];
      return { ids: rows.map((r) => r.listing_id), total: rows.length };
    },
  };
}

/**
 * The searchable document for a listing: `title`; `meta` (stack, model,
 * labels and tools, which anyone may see); and `content` (message text and
 * commands, open-source listings only, matched only for signed-in searches).
 */
export async function searchDocument(db: Db, blobs: BlobStore, listingId: string) {
  const row = db
    .select({
      tier: schema.listings.tier,
      status: schema.listings.status,
      traceId: schema.traces.id,
      title: schema.traces.title,
      model: schema.traces.model,
      language: schema.traces.language,
      framework: schema.traces.framework,
      harness: schema.traces.harness,
      blobKey: schema.traces.blobKey,
    })
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .where(eq(schema.listings.id, listingId))
    .get();
  // A listing withdrawn since its event was queued must not come back into
  // the index, however late the run that handles that event is.
  if (!row || row.status !== "active") return null;
  // Labels by code and by name, so "medical" and "clinical" both find a
  // medical evaluation session.
  const labels = db
    .select({ kind: schema.labels.kind, code: schema.labels.code })
    .from(schema.labels)
    .where(eq(schema.labels.traceId, row.traceId))
    .all()
    .flatMap((l) => [l.code.replace(/_/g, " "), labelName(l.kind as LabelKindId, l.code)]);
  const parts = [row.language, row.framework, row.model, row.harness, ...labels];
  let content = "";
  const raw = await blobs.get(row.blobKey);
  if (raw) {
    const trace = JSON.parse(raw) as Trace;
    const tools = new Set<string>();
    let text = "";
    for (const e of trace.events) {
      if (e.type === "tool_call") tools.add(e.tool);
      if (row.tier === 0 && text.length < MAX_BODY_CHARS) {
        if (e.type === "user_message" || e.type === "assistant_message") text += `\n${e.text}`;
        if (e.type === "tool_call" && e.input && typeof e.input === "object") {
          const cmd = (e.input as Record<string, unknown>).command;
          if (typeof cmd === "string") text += `\n${cmd}`;
        }
      }
    }
    parts.push(...tools);
    content = text.slice(0, MAX_BODY_CHARS);
  }
  return { title: row.title ?? "", meta: parts.filter(Boolean).join("\n"), content };
}

/**
 * Runs of the consumer are serialised per process. Two concurrent runs would
 * peek the same batch, and a slow one could re-index a listing after a
 * faster one had already handled its withdrawal. A separate worker process
 * (S3) would take a lease on the batch instead.
 */
let searchRun: Promise<unknown> = Promise.resolve();

/**
 * Event consumer that keeps the search index in step with listings:
 * index on listing.created, remove on listing.delisted.
 */
export function runSearchConsumer(
  db: Db,
  bus: EventBus,
  blobs: BlobStore,
  index: SearchIndex,
): Promise<number> {
  const run = searchRun.then(() => runSearchConsumerNow(db, bus, blobs, index));
  // The chain must never reject, or every later run would be skipped.
  searchRun = run.catch(() => undefined);
  return run;
}

async function runSearchConsumerNow(
  db: Db,
  bus: EventBus,
  blobs: BlobStore,
  index: SearchIndex,
): Promise<number> {
  const created: string[] = [];
  const delistedTraces: string[] = [];
  // Acknowledged at the end, so an indexing failure leaves the events for the next run.
  const batch = bus.peek("search", 10_000);
  for (const e of batch) {
    const p = e.payload as { listingId?: string; traceId?: string };
    if (e.type === EventTypes.ListingCreated && p.listingId) created.push(p.listingId);
    if (e.type === EventTypes.ListingDelisted && p.traceId) delistedTraces.push(p.traceId);
  }
  for (const id of created) {
    const doc = await searchDocument(db, blobs, id);
    if (doc) await index.index(id, doc);
  }
  if (delistedTraces.length) {
    const ids = db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .where(inArray(schema.listings.traceId, delistedTraces))
      .all();
    for (const { id } of ids) await index.remove(id);
  }
  const last = batch.at(-1);
  if (last) bus.ack("search", last.seq);
  return created.length + delistedTraces.length;
}

/** Rebuild the whole index from the database and blobs (it is never the source of truth). */
export async function rebuildSearchIndex(db: Db, blobs: BlobStore, index: SearchIndex) {
  db.$client.prepare("DELETE FROM listing_search").run();
  const ids = db
    .select({ id: schema.listings.id })
    .from(schema.listings)
    .where(eq(schema.listings.status, "active"))
    .all();
  for (const { id } of ids) {
    const doc = await searchDocument(db, blobs, id);
    if (doc) await index.index(id, doc);
  }
  return ids.length;
}

/**
 * Self-healing check: if the index and the active listings disagree (for
 * example right after upgrading a database that predates the index), rebuild
 * it. Two COUNT queries, so cheap enough to run before each catalog search.
 */
export async function ensureSearchIndex(
  db: Db,
  blobs: BlobStore,
  index: SearchIndex,
): Promise<boolean> {
  const indexed = (
    db.$client.prepare("SELECT count(*) AS n FROM listing_search").get() as { n: number }
  ).n;
  const active = (
    db.$client.prepare("SELECT count(*) AS n FROM listings WHERE status = 'active'").get() as {
      n: number;
    }
  ).n;
  if (indexed === active) return false;
  await rebuildSearchIndex(db, blobs, index);
  return true;
}
