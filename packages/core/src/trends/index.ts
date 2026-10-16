import { and, eq, gte } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { DOMAIN_IDS, labelName } from "@tm/enrich";
import { schema, type Db } from "@tm/db";
import {
  consolidateSignals,
  matchesCriteria,
  median,
  type DemandCriteria,
  type DemandSignalInput,
} from "@tm/pricing";
import { notify } from "../notifications";
import { buildMarket } from "../pricing";

/**
 * What is in demand, for sellers: per domain and per domain × failure, how
 * much buyers are asking for against how much is for sale, what such traces
 * sell for, and which campaigns are bidding. Sellers with expertise in a
 * domain spend their time where it pays; they can ask to hear about new
 * campaigns in their domains.
 */
export interface TrendRow {
  /** "medical" or "medical|user_correction". */
  key: string;
  domain: string;
  failure?: string;
  label: string;
  /** Decayed, per-buyer-deduplicated demand weight in the window. */
  demand: number;
  demandShare: number;
  supply: number;
  supplyShare: number;
  /** Demand share over supply share, smoothed (1 = balanced, >1 = undersupplied). */
  gap: number;
  /**
   * In words: buyers asking and nothing listed ("unsupplied"), nothing
   * asked or listed ("quiet"), or by the gap.
   */
  status: "unsupplied" | "undersupplied" | "balanced" | "crowded" | "quiet";
  /** Demand in the last 7 days against the 7 before: rising, steady or falling. */
  direction: "rising" | "steady" | "falling";
  medianPriceCents: number;
  sales: number;
  openCampaigns: number;
  bestBidCents: number;
  /** The bid landscape: open campaigns' maximum prices, highest first. */
  bids: number[];
}

export interface MarketTrends {
  domains: TrendRow[];
  /** Domain × failure segments, most undersupplied first. */
  segments: TrendRow[];
  totalDemand: number;
  totalSupply: number;
}

const PRIOR = 2;

function gapOf(demandShare: number, supplyShare: number): number {
  return Math.round((100 * (demandShare + 0.01)) / (supplyShare + 0.01)) / 100;
}

export function marketTrends(
  db: Db,
  deps: { config: MarketplaceConfig; now?: Date },
): MarketTrends {
  const now = deps.now ?? new Date();
  const c = deps.config.pricing;
  const market = buildMarket(db, { config: deps.config, now });
  const active = market.active;
  const since = new Date(now.getTime() - c.demand.windowDays * 86_400_000);
  const raw: DemandSignalInput[] = db
    .select()
    .from(schema.demandSignals)
    .where(gte(schema.demandSignals.createdAt, since))
    .all()
    .map((s) => ({
      criteria: s.criteria as DemandCriteria,
      weight: s.weight,
      createdAt: s.createdAt,
      buyerOrgId: s.buyerOrgId ?? undefined,
      kind: s.kind,
    }));
  const signals = consolidateSignals(raw, now, c.demand.windowDays, c.v2.demand);

  const segOf = (domain: string, failure?: string) => `${domain}|${failure ?? "none"}`;
  const demand = new Map<string, number>();
  const add = (k: string, v: number) => demand.set(k, (demand.get(k) ?? 0) + v);
  /** Spread one signal over the segments of the listings it matches. */
  const attribute = (crit: DemandCriteria, w: number, into: (k: string, v: number) => void) => {
    const matched = active.filter((a) => matchesCriteria(a.traits, crit));
    if (matched.length) {
      for (const a of matched)
        into(segOf(a.traits.domain ?? "unknown", a.traits.failureCategory), w / matched.length);
    } else if (crit.domain) {
      into(segOf(crit.domain, crit.failure), w);
    }
  };
  for (const s of signals) attribute(s.criteria, s.weight, add);

  // Direction: raw (undecayed) demand this week against last week.
  const week = 7 * 86_400_000;
  const recent = new Map<string, number>();
  const before = new Map<string, number>();
  for (const s of raw) {
    const age = now.getTime() - s.createdAt.getTime();
    const into = age <= week ? recent : age <= 2 * week ? before : undefined;
    if (into) attribute(s.criteria, s.weight, (k, v) => into.set(k, (into.get(k) ?? 0) + v));
  }

  const supply = new Map<string, number>();
  const prices = new Map<string, number[]>();
  for (const a of active) {
    const k = segOf(a.traits.domain ?? "unknown", a.traits.failureCategory);
    supply.set(k, (supply.get(k) ?? 0) + 1);
    prices.set(k, [...(prices.get(k) ?? []), a.currentPriceCents ?? 0]);
  }

  // Sales in the window, classified by the sold trace's own traits, so a
  // listing withdrawn after it sold still counts.
  const salesBy = new Map<string, number>();
  const sold = db
    .select({ traits: schema.traceTraits.data })
    .from(schema.orderLines)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.orderLines.listingId))
    .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.listings.traceId))
    .where(gte(schema.orderLines.createdAt, since))
    .all();
  for (const s of sold) {
    const t = s.traits as { domain?: string; failureCategory?: string };
    const k = segOf(t.domain ?? "unknown", t.failureCategory);
    salesBy.set(k, (salesBy.get(k) ?? 0) + 1);
  }

  const campaigns = db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.status, "open"))
    .all()
    .map((x) => ({ criteria: x.criteria as DemandCriteria, bid: x.maxPriceCents }));

  // Shares are of what the board shows: supply and demand the labeler could
  // place in a domain. Unknown-domain sessions would otherwise dilute every
  // row while appearing in none.
  const known = (k: string) => !k.startsWith("unknown|");
  const totalDemand = [...demand].filter(([k]) => known(k)).reduce((s, [, v]) => s + v, 0);
  const totalSupply = [...supply].filter(([k]) => known(k)).reduce((s, [, v]) => s + v, 0);

  const row = (
    key: string,
    domain: string,
    failure: string | undefined,
    keys: (k: string) => boolean,
  ): TrendRow => {
    const sum = (m: Map<string, number>) =>
      [...m].filter(([k]) => keys(k)).reduce((s, [, v]) => s + v, 0);
    const d = sum(demand);
    const sup = sum(supply);
    const demandShare = (d + (PRIOR * sup) / Math.max(1, totalSupply)) / (totalDemand + PRIOR);
    const supplyShare = sup / Math.max(1, totalSupply);
    const r = sum(recent);
    const b = sum(before);
    const ps = [...prices].filter(([k]) => keys(k)).flatMap(([, v]) => v);
    const matching = campaigns.filter(
      (x) =>
        (!x.criteria.domain || x.criteria.domain === domain) &&
        (!failure || !x.criteria.failure || x.criteria.failure === failure),
    );
    return {
      key,
      domain,
      failure,
      label: failure
        ? `${labelName("domain", domain)} · ${labelName("failure", failure)}`
        : labelName("domain", domain),
      demand: Math.round(d * 100) / 100,
      demandShare: Math.round(demandShare * 1000) / 1000,
      supply: sup,
      supplyShare: Math.round(supplyShare * 1000) / 1000,
      gap: gapOf(demandShare, supplyShare),
      status:
        sup === 0
          ? d > 0 || matching.length
            ? "unsupplied"
            : "quiet"
          : gapOf(demandShare, supplyShare) >= 1.5
            ? "undersupplied"
            : gapOf(demandShare, supplyShare) <= 0.67
              ? "crowded"
              : "balanced",
      direction: r > b * 1.25 + 0.05 ? "rising" : b > r * 1.25 + 0.05 ? "falling" : "steady",
      medianPriceCents: Math.round(median(ps)),
      sales: sum(salesBy),
      openCampaigns: matching.length,
      bestBidCents: matching.reduce((m, x) => Math.max(m, x.bid), 0),
      bids: matching.map((x) => x.bid).sort((a, b) => b - a),
    };
  };

  const rank = (r: TrendRow) =>
    r.status === "unsupplied" ? 1e6 : r.status === "quiet" ? -1 : r.gap;
  const domains = DOMAIN_IDS.filter((d) => d !== "unknown")
    .map((d) => row(d, d, undefined, (k) => k.startsWith(`${d}|`)))
    .sort((a, b) => rank(b) - rank(a) || b.demand - a.demand);

  // Open campaigns name segments too: one can outlive its demand signal's
  // window while nothing is listed there yet.
  const campaignKeys = campaigns
    .filter((x) => x.criteria.domain && x.criteria.failure)
    .map((x) => segOf(x.criteria.domain!, x.criteria.failure));
  const segKeys = new Set([...supply.keys(), ...demand.keys(), ...campaignKeys]);
  const segments = [...segKeys]
    .filter((k) => !k.startsWith("unknown|") && !k.endsWith("|none"))
    .map((k) => {
      const [domain, failure] = k.split("|") as [string, string];
      return row(k, domain, failure, (x) => x === k);
    })
    .filter((r) => r.demand > 0 || r.openCampaigns > 0)
    .sort((a, b) => rank(b) - rank(a) || b.demand - a.demand)
    .slice(0, 12);

  return {
    domains,
    segments,
    totalDemand: Math.round(totalDemand * 100) / 100,
    totalSupply,
  };
}

// ---------------------------------------------------------------- interests

export function interestsOf(db: Db, userId: string): string[] {
  return db
    .select({ domain: schema.sellerInterests.domain })
    .from(schema.sellerInterests)
    .where(eq(schema.sellerInterests.userId, userId))
    .all()
    .map((r) => r.domain);
}

/** Follow or unfollow a domain. Unknown domain ids are ignored. */
export function setInterest(db: Db, userId: string, domain: string, on: boolean): void {
  if (!(DOMAIN_IDS as readonly string[]).includes(domain) || domain === "unknown") return;
  if (on) {
    db.insert(schema.sellerInterests).values({ userId, domain }).onConflictDoNothing().run();
  } else {
    db.delete(schema.sellerInterests)
      .where(
        and(eq(schema.sellerInterests.userId, userId), eq(schema.sellerInterests.domain, domain)),
      )
      .run();
  }
}

/**
 * Tell sellers who follow a domain that a campaign is now buying in it.
 * Returns how many were told.
 */
export function notifyCampaignFollowers(
  db: Db,
  campaign: {
    id: string;
    title: string;
    criteria: DemandCriteria;
    maxPriceCents: number;
    quantity: number;
    buyerOrgId: string;
  },
  now = new Date(),
): number {
  const domain = campaign.criteria.domain;
  if (!domain) return 0;
  const followers = db
    .select({ userId: schema.sellerInterests.userId })
    .from(schema.sellerInterests)
    .innerJoin(schema.users, eq(schema.users.id, schema.sellerInterests.userId))
    .where(eq(schema.sellerInterests.domain, domain))
    .all()
    // Not the campaign's own team.
    .filter((f) => {
      const u = db
        .select({ org: schema.users.buyerOrgId })
        .from(schema.users)
        .where(eq(schema.users.id, f.userId))
        .get();
      return u?.org !== campaign.buyerOrgId;
    });
  for (const f of followers) {
    notify(db, f.userId, {
      kind: "campaign",
      title: `A buyer wants ${labelName("domain", domain)} traces`,
      body: `A campaign is buying up to ${campaign.quantity} (${campaign.title}) at up to $${(campaign.maxPriceCents / 100).toFixed(2)} each. Matching sessions you share are bought the moment they're listed.`,
      href: "/trends",
      now,
    });
  }
  return followers.length;
}

export * from "./suggestions";
