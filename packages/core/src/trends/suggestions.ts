import { and, eq } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { failureClause, labelName } from "@tm/enrich";
import type { DemandCriteria } from "@tm/pricing";
import { schema, type Db } from "@tm/db";
import { interestsOf, marketTrends, type MarketTrends, type TrendRow } from "./index";

/**
 * "What buyers want from you": the few places a seller's next share pays
 * most, from the trends board, put next to what the seller knows. A segment
 * counts when a campaign is bidding there, buyers ask and nothing is listed,
 * demand outruns supply, or demand is rising. Segments in domains the seller
 * already shares or follows come first; with none, the market's most wanted
 * stand in. Each says why, in words a seller can act on.
 */
export interface SellerSuggestion {
  key: string;
  domain: string;
  failure?: string;
  label: string;
  /** Why it is suggested, one sentence. */
  reason: string;
  /** How it relates to the seller. */
  relation: "yours" | "followed" | "market";
  bestBidCents: number;
  medianPriceCents: number;
  supply: number;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

function whatToShare(r: TrendRow): string {
  const domain = labelName("domain", r.domain);
  if (!r.failure) return `${domain} sessions`;
  return `${domain} sessions where ${failureClause(r.failure)}`;
}

function reasonOf(
  r: TrendRow,
  bids: number[],
  relation: SellerSuggestion["relation"],
  mine: number,
): string {
  const why: string[] = [];
  if (bids.length > 0) {
    why.push(
      `${bids.length} campaign${bids.length > 1 ? "s" : ""} bidding up to ${usd(Math.max(...bids))}`,
    );
  }
  if (r.status === "unsupplied") why.push("buyers are asking and none are listed");
  else if (r.status === "undersupplied")
    why.push(r.gap >= 10 ? "demand far outstrips supply" : `demand is ${r.gap.toFixed(1)}× supply`);
  if (r.direction === "rising") why.push("demand rose this week");
  if (r.supply > 0 && r.medianPriceCents > 0) why.push(`they sell for about ${usd(r.medianPriceCents)}`);
  const head =
    relation === "yours"
      ? `You share ${labelName("domain", r.domain)} sessions (${mine} listed)`
      : relation === "followed"
        ? `You follow ${labelName("domain", r.domain)}`
        : "Wanted across the market";
  return `${head}: ${why.join(", ")}.`;
}

/** The seller's active listings per domain. */
function domainsShared(db: Db, sellerId: string): Map<string, number> {
  const rows = db
    .select({ traits: schema.traceTraits.data })
    .from(schema.listings)
    .innerJoin(schema.traces, eq(schema.traces.id, schema.listings.traceId))
    .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.listings.traceId))
    .where(and(eq(schema.traces.sellerId, sellerId), eq(schema.listings.status, "active")))
    .all();
  const m = new Map<string, number>();
  for (const r of rows) {
    const d = (r.traits as { domain?: string }).domain;
    if (d && d !== "unknown") m.set(d, (m.get(d) ?? 0) + 1);
  }
  return m;
}

export function sellerSuggestions(
  db: Db,
  deps: { config: MarketplaceConfig; now?: Date; trends?: MarketTrends },
  sellerId: string,
): SellerSuggestion[] {
  const cfg = deps.config.discovery.sellerSuggestions;
  const t = deps.trends ?? marketTrends(db, deps);
  const mine = domainsShared(db, sellerId);
  const followed = new Set(interestsOf(db, sellerId));
  const relationOf = (d: string): SellerSuggestion["relation"] =>
    mine.has(d) ? "yours" : followed.has(d) ? "followed" : "market";

  // Campaigns that would buy any session matching the row: only domain and
  // failure can be named in a suggestion, so a campaign that also needs a
  // language, framework or model doesn't count here (a Rust-only campaign is
  // not a bid for "Medical sessions"). Open and unexpired.
  const now = deps.now ?? new Date();
  const campaigns = db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.status, "open"))
    .all()
    .filter((c) => c.expiresAt.getTime() > now.getTime())
    .map((c) => ({ criteria: c.criteria as DemandCriteria, bid: c.maxPriceCents }))
    .filter(({ criteria }) =>
      Object.entries(criteria).every(([k, v]) => v == null || k === "domain" || k === "failure"),
    );
  const bidsFor = (r: TrendRow) =>
    campaigns
      .filter(
        ({ criteria: c }) =>
          (!c.domain || c.domain === r.domain) && (!c.failure || c.failure === r.failure),
      )
      .map((c) => c.bid);
  const bids = new Map<string, number[]>();
  const bidsOf = (r: TrendRow) => {
    if (!bids.has(r.key)) bids.set(r.key, bidsFor(r));
    return bids.get(r.key)!;
  };

  const wanted = (r: TrendRow) =>
    bidsOf(r).length > 0 ||
    r.status === "unsupplied" ||
    r.status === "undersupplied" ||
    (r.direction === "rising" && r.status !== "crowded");
  // How much a share there is worth: bids count most, then scarcity, then momentum.
  const score = (r: TrendRow) =>
    (bidsOf(r).length > 0 ? cfg.campaign + Math.max(...bidsOf(r)) / 1000 : 0) +
    (r.status === "unsupplied" ? cfg.unsupplied : r.status === "undersupplied" ? r.gap : 0) +
    (r.direction === "rising" ? cfg.rising : 0);
  const boost = (r: TrendRow) => {
    const rel = relationOf(r.domain);
    return rel === "yours" ? cfg.yoursBoost : rel === "followed" ? cfg.followedBoost : 1;
  };

  // Segments name what to share; a domain row stands in when no segment in
  // that domain qualifies. Boosts put the seller's own domains first.
  const candidates = [...t.segments, ...t.domains].filter(wanted);
  const ranked = candidates
    .map((r) => ({ r, s: score(r) * boost(r) }))
    .sort((a, b) => b.s - a.s || b.r.demand - a.r.demand);
  const out: SellerSuggestion[] = [];
  const domainsPicked = new Set<string>();
  for (const { r } of ranked) {
    if (out.length >= cfg.limit) break;
    const rel = relationOf(r.domain);
    // One per domain, so the suggestions spread across what the seller knows.
    if (domainsPicked.has(r.domain)) continue;
    domainsPicked.add(r.domain);
    out.push({
      key: r.key,
      domain: r.domain,
      failure: r.failure,
      label: whatToShare(r),
      reason: reasonOf(r, bidsOf(r), rel, mine.get(r.domain) ?? 0),
      relation: rel,
      bestBidCents: Math.max(0, ...bidsOf(r)),
      medianPriceCents: r.medianPriceCents,
      supply: r.supply,
    });
  }
  return out;
}
