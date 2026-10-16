import { and, desc, eq } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { newId, schema, type Db } from "@tm/db";
import { isEmptyCriteria } from "@tm/pricing";
import type { PublicUser } from "../auth";
import { criteriaOf, type BrowseQuery } from "../catalog/browse";
import type { EventBus } from "../events";
import { recordDemandSignal, runPricingConsumer } from "../pricing";

/** The parts of a catalog query worth saving (no paging or sorting). */
export type SavedQuery = Pick<
  BrowseQuery,
  | "text"
  | "domain"
  | "authenticity"
  | "language"
  | "framework"
  | "failure"
  | "outcome"
  | "tier"
  | "model"
  | "source"
>;

/** Most saved searches a buyer team keeps. */
export const MAX_SAVED_SEARCHES = 20;

export interface SavedSearch {
  id: string;
  name: string;
  query: SavedQuery;
  createdAt: Date;
}

export class SavedSearchError extends Error {}

const KEYS: (keyof SavedQuery)[] = [
  "text",
  "domain",
  "authenticity",
  "language",
  "framework",
  "failure",
  "outcome",
  "tier",
  "model",
  "source",
];

function clean(q: SavedQuery): SavedQuery {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const raw = q[k];
    // Whitespace is not a filter: "   " is as empty as "".
    const v = typeof raw === "string" ? raw.trim() : raw;
    if (v === undefined || v === "") continue;
    if (k === "tier") out.tier = v === 1 || v === "1" ? 1 : 0;
    else out[k] = String(v).slice(0, 200);
  }
  return out as SavedQuery;
}

/**
 * Save a buyer's search, as a query collection. Saving is a stronger signal
 * than searching, so it is recorded as "save" demand and prices reprice.
 */
export function saveSearch(
  db: Db,
  deps: { config: MarketplaceConfig; bus: EventBus },
  user: PublicUser,
  input: { name?: string; query: SavedQuery },
): SavedSearch {
  if (!user.buyerOrgId) throw new SavedSearchError("Only buyer accounts can save searches.");
  const query = clean(input.query);
  if (Object.keys(query).length === 0) {
    throw new SavedSearchError("Search for something before saving it.");
  }
  if (listSavedSearches(db, user.buyerOrgId).length >= MAX_SAVED_SEARCHES) {
    throw new SavedSearchError(
      `You can keep ${MAX_SAVED_SEARCHES} saved searches. Delete one to save another.`,
    );
  }
  const criteria = criteriaOf(query);
  const id = newId("col");
  const now = new Date();
  const name = (input.name?.trim() || describe(query)).slice(0, 120);
  db.insert(schema.collections)
    .values({ id, buyerOrgId: user.buyerOrgId, name, kind: "query", query, createdAt: now })
    .run();
  if (!isEmptyCriteria(criteria)) {
    recordDemandSignal(db, deps.bus, {
      kind: "save",
      criteria,
      weight: deps.config.pricing.demand.signalWeights.save,
      buyerOrgId: user.buyerOrgId,
      now,
    });
    runPricingConsumer(db, deps.bus, { config: deps.config, now });
  }
  return { id, name, query, createdAt: now };
}

export function listSavedSearches(db: Db, buyerOrgId: string): SavedSearch[] {
  return db
    .select()
    .from(schema.collections)
    .where(and(eq(schema.collections.buyerOrgId, buyerOrgId), eq(schema.collections.kind, "query")))
    .orderBy(desc(schema.collections.createdAt))
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      query: (r.query ?? {}) as SavedQuery,
      createdAt: r.createdAt,
    }));
}

export function deleteSavedSearch(db: Db, buyerOrgId: string, id: string): boolean {
  const r = db
    .delete(schema.collections)
    .where(
      and(
        eq(schema.collections.id, id),
        eq(schema.collections.buyerOrgId, buyerOrgId),
        eq(schema.collections.kind, "query"),
      ),
    )
    .run();
  return r.changes > 0;
}

/** A short name for a query, e.g. "medical · retry loop · “warehouse”". */
export function describe(q: SavedQuery): string {
  const parts = [
    q.domain?.replace(/_/g, " "),
    q.language,
    q.framework,
    q.failure?.replace(/_/g, " "),
    q.outcome?.replace(/_/g, " "),
    q.authenticity,
    q.tier === undefined ? undefined : q.tier === 1 ? "signals only" : "open source",
    q.model,
    q.source,
    q.text ? `“${q.text}”` : undefined,
  ].filter(Boolean);
  return parts.join(" · ") || "All traces";
}
