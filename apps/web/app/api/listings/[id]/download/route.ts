import { NextResponse } from "next/server";
import { downloadable } from "@tm/core";
import { fail } from "@/lib/api";
import { getBlobs, getCurrentUser, getDb } from "@/lib/server";

/** The licensed trace as JSON, with the licence it is held under. Entitlement required. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await params;
  const d = downloadable(getDb(), user, id);
  if (!d) return fail("You don't hold a licence for this trace.", 403);
  const raw = await getBlobs().get(d.blobKey);
  if (!raw) return fail("The stored trace is missing.", 404);
  const body = JSON.stringify(
    {
      license: {
        listingId: id,
        scopes: d.scopes,
        licensee: user.buyerOrgId,
        content: d.tier === 1 ? "signals only" : "scrubbed session",
        terms: "Non-exclusive. Use only within the licensed scopes; do not redistribute.",
      },
      trace: JSON.parse(raw),
    },
    null,
    2,
  );
  return new NextResponse(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="trace-${id}.json"`,
      "cache-control": "no-store",
    },
  });
}
