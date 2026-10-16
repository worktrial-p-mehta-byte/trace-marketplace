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
    items?: { key: string; traits: TraceTraits; tier: 0 | 1 }[];
  } | null;
  if (!body?.items?.length || body.items.length > 200)
    return fail("Send between 1 and 200 sessions.");
  try {
    const config = getConfig();
    // Sessions of the same shape shared together become near-duplicates of
    // each other once listed, so each estimate counts its batch siblings.
    const shapes = new Map<string, number>();
    for (const it of body.items) {
      const k = it.traits?.shapeKey;
      if (k) shapes.set(k, (shapes.get(k) ?? 0) + 1);
    }
    const quotes = body.items.map((it) => {
      const k = it.traits?.shapeKey;
      const q = estimatePrice(getDb(), { config }, it.traits, it.tier === 1 ? 1 : 0, {
        sellerId: user.id,
        pendingSameShape: k ? (shapes.get(k) ?? 1) - 1 : 0,
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
