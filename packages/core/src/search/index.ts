import { eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@tm/db";
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
    "INSERT INTO listing_search (listing_id, title, body) VALUES (?, ?, ?)",
  );
  const find = db.$client.prepare(
    "SELECT listing_id FROM listing_search WHERE listing_search MATCH ? ORDER BY bm25(listing_search, 0, 3.0, 1.0) LIMIT ?",
  );
  return {
    async index(listingId, doc) {
      db.$client.transaction(() => {
        del.run(listingId);
        ins.run(listingId, String(doc.title ?? ""), String(doc.body ?? ""));
      })();
    },
    async remove(listingId) {
      del.run(listingId);
    },
    async search(q: SearchQuery) {
      const fts = q.text ? toFtsQuery(q.text) : null;
      if (!fts) return { ids: [], total: 0 };
      const rows = find.all(fts, q.limit ?? 10_000) as { listing_id: string }[];
      return { ids: rows.map((r) => r.listing_id), total: rows.length };
    },
  };
}

/**
 * The searchable document for a listing: title, stack, model, labels and
 * tools for every listing; message text too for open-source (tier 0)
 * listings, since that content is shown to signed-in buyers anyway.
 */
export async function searchDocument(db: Db, blobs: BlobStore, listingId: string) {
  const row = db
    .select({
      tier: schema.listings.tier,
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
  if (!row) return null;
  const labels = db
    .select({ code: schema.labels.code })
    .from(schema.labels)
    .where(eq(schema.labels.traceId, row.traceId))
    .all()
    .map((l) => l.code.replace(/_/g, " "));
  const parts = [row.language, row.framework, row.model, row.harness, ...labels];
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
    parts.push(...tools, text.slice(0, MAX_BODY_CHARS));
  }
  return { title: row.title ?? "", body: parts.filter(Boolean).join("\n") };
}

/**
 * Event consumer that keeps the search index in step with listings:
 * index on listing.created, remove on listing.delisted.
 */
export async function runSearchConsumer(
  db: Db,
  bus: EventBus,
  blobs: BlobStore,
  index: SearchIndex,
): Promise<number> {
  const created: string[] = [];
  const delistedTraces: string[] = [];
  bus.poll(
    "search",
    (e) => {
      const p = e.payload as { listingId?: string; traceId?: string };
      if (e.type === EventTypes.ListingCreated && p.listingId) created.push(p.listingId);
      if (e.type === EventTypes.ListingDelisted && p.traceId) delistedTraces.push(p.traceId);
    },
    10_000,
  );
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
