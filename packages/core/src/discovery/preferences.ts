import { and, eq } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { DOMAIN_IDS, FAILURE_CODES, labelName } from "@tm/enrich";
import { newId, schema, type Db } from "@tm/db";
import type { LicenseScope } from "@tm/schema";
import type { PublicUser } from "../auth";
import { browseCatalog, type CatalogItem } from "../catalog/browse";
import {
  addInterest,
  emptyProfile,
  interestProfile,
  interestWeight,
  type Interest,
  type InterestDim,
  type InterestSource,
} from "./behaviour";
import { orgMemberIds } from "../checkout";
import type { EventBus } from "../events";
import type { SearchIndex } from "../ports";
import { buildMarket, recordDemandSignal, runPricingConsumer } from "../pricing";

/**
 * What a buyer team told us when it joined: the domains and behaviours it
 * needs, how it will use the data, whether it needs the content, and what it
 * pays per trace. Stored as a "preferences" collection, it shapes the
 * catalog ("Picked for you"), the default licence, and a suggested campaign.
 */
export interface BuyerPreferences {
  domains: string[];
  failures: string[];
  license: LicenseScope;
  /** Needs the content (open source only), or signals only is fine. */
  contentNeeded: boolean;
  /** What the team expects to pay per trace, in cents. */
  maxPriceCents?: number;
}

export class PreferencesError extends Error {}

const NAME = "Preferences";
const LICENSES: LicenseScope[] = ["research", "eval", "training"];

function prefsRow(db: Db, orgId: string) {
  // Its own kind, so a saved search can never be mistaken for it, whatever
  // it is called.
  return db
    .select()
    .from(schema.collections)
    .where(
      and(eq(schema.collections.buyerOrgId, orgId), eq(schema.collections.kind, "preferences")),
    )
    .get();
}

export function getBuyerPreferences(db: Db, orgId: string): BuyerPreferences | undefined {
  const row = prefsRow(db, orgId);
  return row?.query ? (row.query as BuyerPreferences) : undefined;
}

export function setBuyerPreferences(
  db: Db,
  deps: { config: MarketplaceConfig; bus: EventBus },
  user: PublicUser,
  input: Partial<BuyerPreferences>,
): BuyerPreferences {
  if (!user.buyerOrgId) throw new PreferencesError("Preferences are for buyer accounts.");
  const domains = [...new Set(input.domains ?? [])].filter(
    (d) => (DOMAIN_IDS as readonly string[]).includes(d) && d !== "unknown",
  );
  if (!domains.length) throw new PreferencesError("Pick at least one domain.");
  const failures = [...new Set(input.failures ?? [])].filter((f) =>
    (FAILURE_CODES as readonly string[]).includes(f),
  );
  const prefs: BuyerPreferences = {
    domains,
    failures,
    license: LICENSES.includes(input.license as LicenseScope) ? input.license! : "research",
    contentNeeded: Boolean(input.contentNeeded),
    maxPriceCents:
      input.maxPriceCents && input.maxPriceCents > 0 ? Math.round(input.maxPriceCents) : undefined,
  };
  const row = prefsRow(db, user.buyerOrgId);
  if (row) {
    db.update(schema.collections)
      .set({ query: prefs })
      .where(eq(schema.collections.id, row.id))
      .run();
  } else {
    db.insert(schema.collections)
      .values({
        id: newId("col"),
        buyerOrgId: user.buyerOrgId,
        name: NAME,
        kind: "preferences",
        query: prefs,
      })
      .run();
  }
  // What a buyer says it needs is demand, like a saved search per domain.
  const now = new Date();
  for (const domain of domains) {
    recordDemandSignal(db, deps.bus, {
      kind: "save",
      criteria: failures.length === 1 ? { domain, failure: failures[0] } : { domain },
      weight: deps.config.pricing.demand.signalWeights.save,
      buyerOrgId: user.buyerOrgId,
      now,
    });
  }
  runPricingConsumer(db, deps.bus, { config: deps.config, now });
  return prefs;
}

/** A pick, with why it was picked in words. */
export type PickedItem = CatalogItem & { pickReason: string };

const SOURCE_ORDER: InterestSource[] = ["purchase", "stated", "save", "view", "search"];

function interestName(dim: InterestDim, v: string): string {
  if (dim === "domain") return labelName("domain", v);
  if (dim === "failure") return labelName("failure", v).toLowerCase();
  return v;
}

/** Why a pick matches, from the strongest evidence behind its best interest. */
function reasonFor(dim: InterestDim, value: string, i: Interest): string {
  const source = SOURCE_ORDER.filter((s) => (i.weight[s] ?? 0) > 0).sort(
    (a, b) => (i.weight[b] ?? 0) - (i.weight[a] ?? 0),
  )[0];
  const name = interestName(dim, value);
  const n = source ? (i.count[source] ?? 1) : 1;
  const sessions = dim === "failure" ? `sessions with ${name}` : `${name} sessions`;
  switch (source) {
    case "stated":
      return `You said you need ${dim === "failure" ? `sessions with ${name}` : name}`;
    case "purchase":
      return `Like the ${n === 1 ? "" : `${n} `}${dim === "failure" ? `traces with ${name}` : `${name} trace${n === 1 ? "" : "s"}`} your team bought`;
    case "save":
      return `Matches your saved search for ${name}`;
    case "view":
      return `Because your team viewed ${sessions}`;
    case "search":
      return `Because your team searched for ${sessions}`;
    default:
      return `Matches ${name}`;
  }
}

/**
 * Listings picked for a buyer team, deterministically, from what it said it
 * needs (onboarding answers) and what it does (views, searches, saved
 * searches and purchases, decayed by age; see interestProfile). Either is
 * enough on its own. Picks are in the team's top domains, ranked by how well
 * they match its strongest interests and by quality (recovered, verified,
 * consistent, rare), priced under its licence and within budget, never ones
 * it already holds or its own members', at most two of one shape. Each
 * carries the reason it was picked.
 */
export async function recommendFor(
  db: Db,
  deps: { config: MarketplaceConfig; search: SearchIndex; now?: Date },
  prefs: BuyerPreferences | undefined,
  limit = 6,
  /** The team the picks are for: its behaviour, its held licences and its own listings. */
  buyerOrgId?: string,
): Promise<PickedItem[]> {
  const cfg = deps.config.discovery.picks;
  const profile = buyerOrgId ? interestProfile(db, deps, buyerOrgId) : emptyProfile();
  if (prefs) {
    addInterest(profile, "stated", { domain: prefs.domains, failure: prefs.failures }, cfg.stated);
  }
  const ranked = (dim: InterestDim) =>
    [...profile.dims[dim]].sort((a, b) => interestWeight(b[1]) - interestWeight(a[1]));
  const maxOf = (dim: InterestDim) => interestWeight(ranked(dim)[0]?.[1]);
  // The team's domains: what it said, then what it does, at most three.
  const domains = [
    ...new Set([...(prefs?.domains ?? []), ...ranked("domain").map(([d]) => d)]),
  ].slice(0, Math.max(3, prefs?.domains.length ?? 0));
  if (!domains.length) return [];
  const license = prefs?.license ?? "research";

  const members = buyerOrgId ? orgMemberIds(db, buyerOrgId) : new Set<string>();
  // Prices under the team's own licence (evaluation and training cost more
  // than research), for both the budget and what the picks show.
  const market = buildMarket(db, { config: deps.config, now: deps.now });
  const rows = new Map(market.active.map((a) => [a.listingId, a]));
  // Only what the team can actually buy under its licence.
  const offered = new Set(
    db
      .select({ id: schema.listings.id, allowed: schema.listings.allowedLicenses })
      .from(schema.listings)
      .where(eq(schema.listings.status, "active"))
      .all()
      .filter((r) => r.allowed.includes(license))
      .map((r) => r.id),
  );
  const pool: CatalogItem[] = [];
  for (const domain of domains) {
    // The whole domain: ranking happens below, after the budget, so a cheap
    // match is never cut off by a page of expensive ones.
    const r = await browseCatalog(db, deps, {
      domain,
      tier: prefs?.contentNeeded ? 0 : undefined,
      limit: Number.MAX_SAFE_INTEGER,
    });
    for (const i of r.items) {
      const row = rows.get(i.listingId);
      if (!row || members.has(row.sellerId) || !offered.has(i.listingId)) continue;
      // Already licensed: nothing to pick.
      if (profile.held.has(i.listingId)) continue;
      const priceCents = market.quote(row, license).priceCents;
      if (prefs?.maxPriceCents && priceCents > prefs.maxPriceCents) continue;
      pool.push({ ...i, priceCents });
    }
  }

  const max = Object.fromEntries(
    (["domain", "failure", "language", "framework"] as InterestDim[]).map((d) => [d, maxOf(d)]),
  ) as Record<InterestDim, number>;
  const valuesOf = (i: CatalogItem): Record<InterestDim, string[]> => ({
    domain: [i.domain],
    failure: i.failures,
    language: i.language ? [i.language] : [],
    framework: i.framework ? [i.framework] : [],
  });
  const quality = (i: CatalogItem) =>
    (i.outcomes.includes("recovered") ? 1 : 0) +
    (i.outcomes.includes("tests_passed") ? 0.5 : 0) +
    (i.authenticity === "consistent" ? 0.5 : i.authenticity === "flagged" ? -3 : 0) +
    Math.min(1, i.rarity / 2);
  const scored = pool.map((i) => {
    let s = quality(i);
    let best: { dim: InterestDim; value: string; points: number } | undefined;
    const vals = valuesOf(i);
    for (const dim of ["domain", "failure", "language", "framework"] as InterestDim[]) {
      if (!max[dim]) continue;
      for (const v of vals[dim]) {
        const w = interestWeight(profile.dims[dim].get(v));
        if (!w) continue;
        // Each dimension adds at most its match weight, for the team's strongest interest.
        const points = (cfg.match[dim] * w) / max[dim];
        if (!best || points > best.points) best = { dim, value: v, points };
      }
      const top = Math.max(0, ...vals[dim].map((v) => interestWeight(profile.dims[dim].get(v))));
      if (top) s += (cfg.match[dim] * top) / max[dim];
    }
    // The reason names the most specific strong match: a wanted failure
    // beats the domain it sits in when it scores close.
    const failure = vals.failure
      .map((v) => ({ v, w: interestWeight(profile.dims.failure.get(v)) }))
      .sort((a, b) => b.w - a.w)[0];
    const reasonDim =
      failure && failure.w > 0 && max.failure
        ? { dim: "failure" as InterestDim, value: failure.v }
        : best
          ? { dim: best.dim, value: best.value }
          : undefined;
    const pickReason = reasonDim
      ? reasonFor(reasonDim.dim, reasonDim.value, profile.dims[reasonDim.dim].get(reasonDim.value)!)
      : `A strong ${labelName("domain", i.domain)} session`;
    return { i: { ...i, pickReason }, s };
  });
  const seen = new Map<string, number>();
  return scored
    .sort((a, b) => b.s - a.s || b.i.priceCents - a.i.priceCents)
    .filter(({ i }) => {
      if (!i.shapeKey) return true;
      const n = seen.get(i.shapeKey) ?? 0;
      seen.set(i.shapeKey, n + 1);
      return n < 2;
    })
    .slice(0, limit)
    .map(({ i }) => i);
}

/** A campaign that fits the preferences, as text the campaign form understands. */
export function suggestedCampaign(prefs: BuyerPreferences): {
  describe: string;
  maxPrice: string;
  license: LicenseScope;
} {
  const failure = prefs.failures[0]?.replace(/_/g, " ");
  return {
    describe: [prefs.domains[0]?.replace(/_/g, " "), failure].filter(Boolean).join(" "),
    maxPrice: ((prefs.maxPriceCents ?? 1500) / 100).toFixed(2),
    license: prefs.license,
  };
}
