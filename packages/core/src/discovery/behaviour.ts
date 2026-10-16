import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { FAILURE_CODES, type TraceTraits } from "@tm/enrich";
import { schema, type Db } from "@tm/db";
import type { DemandCriteria } from "@tm/pricing";
import { criteriaOf } from "../catalog/browse";
import type { SavedQuery } from "./saved";

/** Where an interest came from, strongest evidence first. */
export type InterestSource = "stated" | "purchase" | "save" | "view" | "search";
export type InterestDim = "domain" | "failure" | "language" | "framework";

export const INTEREST_DIMS: InterestDim[] = ["domain", "failure", "language", "framework"];

/** One value of one dimension (e.g. domain "medical"): its weight and how many actions, per source. */
export interface Interest {
  weight: Partial<Record<InterestSource, number>>;
  count: Partial<Record<InterestSource, number>>;
}

/**
 * What a buyer team is interested in, from its own behaviour in the recent
 * window: searches, views, saved searches and what it bought, each weighted
 * by how much it says (purchase > save > view > search) and decayed by age.
 */
export interface InterestProfile {
  dims: Record<InterestDim, Map<string, Interest>>;
  /** Listings the team holds a live licence for. */
  held: Set<string>;
  /** Whether any behaviour was found at all. */
  empty: boolean;
}

export function emptyProfile(): InterestProfile {
  return {
    dims: { domain: new Map(), failure: new Map(), language: new Map(), framework: new Map() },
    held: new Set(),
    empty: true,
  };
}

const DAY_MS = 86_400_000;

/** Add one piece of evidence (already weighted and decayed) to the profile. */
export function addInterest(
  profile: InterestProfile,
  source: InterestSource,
  values: Partial<Record<InterestDim, string[]>>,
  weight: number,
): void {
  if (weight <= 0) return;
  for (const dim of INTEREST_DIMS) {
    for (const v of new Set(values[dim] ?? [])) {
      if (!v || v === "unknown") continue;
      const map = profile.dims[dim];
      const cur = map.get(v) ?? { weight: {}, count: {} };
      cur.weight[source] = (cur.weight[source] ?? 0) + weight;
      cur.count[source] = (cur.count[source] ?? 0) + 1;
      map.set(v, cur);
    }
  }
  if (source !== "stated") profile.empty = false;
}

function fromCriteria(c: DemandCriteria): Partial<Record<InterestDim, string[]>> {
  return {
    domain: c.domain ? [c.domain] : [],
    failure: c.failure ? [c.failure] : [],
    language: c.language ? [c.language] : [],
    framework: c.framework ? [c.framework] : [],
  };
}

/**
 * Build a team's interest profile from what it did in the window ending at
 * `now`. Searches and views come from its demand signals; saves from its
 * saved searches (not the save demand its onboarding answers record, so a
 * stated answer is never mistaken for behaviour); purchases from the
 * licences it holds, with the domain, failures and stack of each trace.
 */
export function interestProfile(
  db: Db,
  deps: { config: MarketplaceConfig; now?: Date },
  buyerOrgId: string,
): InterestProfile {
  const cfg = deps.config.discovery.picks;
  const now = (deps.now ?? new Date()).getTime();
  const since = new Date(now - cfg.windowDays * DAY_MS);
  const decay = (at: Date) => {
    const age = Math.max(0, now - at.getTime()) / DAY_MS;
    return Math.pow(0.5, age / cfg.halfLifeDays);
  };
  const inWindow = (at: Date) => at.getTime() >= since.getTime() && at.getTime() <= now;
  const profile = emptyProfile();

  const signals = db
    .select({
      kind: schema.demandSignals.kind,
      criteria: schema.demandSignals.criteria,
      createdAt: schema.demandSignals.createdAt,
    })
    .from(schema.demandSignals)
    .where(
      and(
        eq(schema.demandSignals.buyerOrgId, buyerOrgId),
        inArray(schema.demandSignals.kind, ["search", "view"]),
        gte(schema.demandSignals.createdAt, since),
      ),
    )
    .all();
  for (const s of signals) {
    if (!inWindow(s.createdAt)) continue;
    const kind = s.kind as "search" | "view";
    addInterest(
      profile,
      kind,
      fromCriteria(s.criteria as DemandCriteria),
      cfg.weights[kind] * decay(s.createdAt),
    );
  }

  const saved = db
    .select({ query: schema.collections.query, createdAt: schema.collections.createdAt })
    .from(schema.collections)
    .where(and(eq(schema.collections.buyerOrgId, buyerOrgId), eq(schema.collections.kind, "query")))
    .all();
  for (const s of saved) {
    if (!inWindow(s.createdAt)) continue;
    addInterest(
      profile,
      "save",
      fromCriteria(criteriaOf((s.query ?? {}) as SavedQuery)),
      cfg.weights.save * decay(s.createdAt),
    );
  }

  // What the team holds a licence for: each trace once, dated by its first licence.
  const bought = db
    .select({
      listingId: schema.orderLines.listingId,
      traceId: schema.listings.traceId,
      language: schema.traces.language,
      framework: schema.traces.framework,
      traits: schema.traceTraits.data,
      grantedAt: schema.entitlements.grantedAt,
    })
    .from(schema.entitlements)
    .innerJoin(schema.licenses, eq(schema.licenses.id, schema.entitlements.licenseId))
    .innerJoin(schema.orderLines, eq(schema.orderLines.id, schema.licenses.orderLineId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.orderLines.listingId))
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.traces.id))
    .where(
      and(eq(schema.entitlements.buyerOrgId, buyerOrgId), isNull(schema.entitlements.revokedAt)),
    )
    .all();
  const first = new Map<string, (typeof bought)[number]>();
  for (const b of bought) {
    profile.held.add(b.listingId);
    const cur = first.get(b.listingId);
    if (!cur || b.grantedAt < cur.grantedAt) first.set(b.listingId, b);
  }
  const recent = [...first.values()].filter((b) => inWindow(b.grantedAt));
  const failureCodes = new Set<string>(FAILURE_CODES);
  const failuresOf = new Map<string, string[]>();
  if (recent.length) {
    for (const l of db
      .select({ traceId: schema.labels.traceId, code: schema.labels.code })
      .from(schema.labels)
      .where(
        inArray(
          schema.labels.traceId,
          recent.map((b) => b.traceId),
        ),
      )
      .all()) {
      if (!failureCodes.has(l.code)) continue;
      failuresOf.set(l.traceId, [...(failuresOf.get(l.traceId) ?? []), l.code]);
    }
  }
  for (const b of recent) {
    const traits = b.traits as TraceTraits;
    addInterest(
      profile,
      "purchase",
      {
        domain: traits.domain ? [traits.domain] : [],
        failure: failuresOf.get(b.traceId) ?? [],
        language: b.language ? [b.language] : [],
        framework: b.framework ? [b.framework] : [],
      },
      cfg.weights.purchase * decay(b.grantedAt),
    );
  }
  return profile;
}

/** Total weight of an interest across sources. */
export function interestWeight(i: Interest | undefined): number {
  if (!i) return 0;
  return Object.values(i.weight).reduce((a, b) => a + (b ?? 0), 0);
}
