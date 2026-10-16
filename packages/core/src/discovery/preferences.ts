import { and, eq } from "drizzle-orm";
import type { MarketplaceConfig } from "@tm/config";
import { DOMAIN_IDS, FAILURE_CODES } from "@tm/enrich";
import { newId, schema, type Db } from "@tm/db";
import type { LicenseScope } from "@tm/schema";
import type { PublicUser } from "../auth";
import { browseCatalog, type CatalogItem } from "../catalog/browse";
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

/**
 * Listings picked for a buyer: in their domains, with the behaviours they
 * asked for ranked first, content where they need it, within their price,
 * consistent sessions and verified recoveries ahead, at most two of one
 * shape. Deterministic; no model.
 */
export async function recommendFor(
  db: Db,
  deps: { config: MarketplaceConfig; search: SearchIndex; now?: Date },
  prefs: BuyerPreferences,
  limit = 6,
  /** The team the picks are for: its own members' listings are left out. */
  buyerOrgId?: string,
): Promise<CatalogItem[]> {
  const members = buyerOrgId ? orgMemberIds(db, buyerOrgId) : new Set<string>();
  // Prices under the team's own licence (evaluation and training cost more
  // than research), for both the budget and what the picks show.
  const market = buildMarket(db, { config: deps.config, now: deps.now });
  const rows = new Map(market.active.map((a) => [a.listingId, a]));
  const pool: CatalogItem[] = [];
  for (const domain of prefs.domains) {
    // The whole domain: ranking happens below, after the budget, so a cheap
    // match is never cut off by a page of expensive ones.
    const r = await browseCatalog(db, deps, {
      domain,
      tier: prefs.contentNeeded ? 0 : undefined,
      limit: Number.MAX_SAFE_INTEGER,
    });
    for (const i of r.items) {
      const row = rows.get(i.listingId);
      if (!row || members.has(row.sellerId)) continue;
      const priceCents = market.quote(row, prefs.license).priceCents;
      if (prefs.maxPriceCents && priceCents > prefs.maxPriceCents) continue;
      pool.push({ ...i, priceCents });
    }
  }
  const want = new Set(prefs.failures);
  const score = (i: CatalogItem) =>
    (i.failures.some((f) => want.has(f)) ? 3 : 0) +
    (i.outcomes.includes("recovered") ? 1 : 0) +
    (i.outcomes.includes("tests_passed") ? 0.5 : 0) +
    (i.authenticity === "consistent" ? 0.5 : i.authenticity === "flagged" ? -3 : 0) +
    Math.min(1, i.rarity / 2);
  const seen = new Map<string, number>();
  return pool
    .map((i) => ({ i, s: score(i) }))
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
