import { NextResponse } from "next/server";
import { estimatePrice } from "@tm/core";
import type { TraceTraits } from "@tm/enrich";
import { sellerShareFor } from "@tm/config";
import { splitSale } from "@tm/pricing";
import { fail, handle } from "@/lib/api";
import { getConfig, getCurrentUser, getDb } from "@/lib/server";

/**
 * Price a session before it is shared. The browser sends traits only
 * (counts, flags, language, model), never content.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.", 401);
  const body = (await req.json().catch(() => null)) as {
    items?: { key: string; traits: TraceTraits; tier: 0 | 1; selected?: boolean }[];
  } | null;
  if (!body?.items?.length || body.items.length > 200)
    return fail("Send between 1 and 200 sessions.");
  try {
    const config = getConfig();
    // The sessions selected to share together join the market together, so
    // each estimate counts the other selected ones as batch siblings (in the
    // cohorts they share; same-shape ones as near-duplicates). An unselected
    // session is priced as if it were added to the selection.
    const selected = body.items.filter((it) => it.selected !== false);
    const quotes = body.items.map((it) => {
      const q = estimatePrice(getDb(), { config }, it.traits, it.tier === 1 ? 1 : 0, {
        sellerId: user.id,
        pendingSiblings: selected.filter((o) => o !== it).map((o) => o.traits),
      });
      const share = sellerShareFor(config, it.traits.domain);
      return {
        key: it.key,
        priceCents: q.priceCents,
        sellerCents: splitSale(q.priceCents, share).seller,
        sellerShare: share,
        summary: q.summary,
        drivers: q.drivers,
        factors: q.factors,
        band: q.band,
      };
    });
    return NextResponse.json({ quotes, sellerShare: config.revenue.sellerShare });
  } catch (e) {
    return handle(e);
  }
}
