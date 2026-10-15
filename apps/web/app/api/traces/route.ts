import { NextResponse } from "next/server";
import { canSell, shareTrace } from "@tm/core";
import { fail, handle } from "@/lib/api";
import { readJsonLimited } from "@/lib/body";
import { getBlobs, getBus, getConfig, getCurrentUser, getDb, getSearch } from "@/lib/server";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in to share traces.", 401);
  if (!canSell(user)) return fail("Your account is set up for buying only.", 403);
  // Enforced on the bytes actually read, so omitting Content-Length can't bypass it.
  const read = await readJsonLimited(req, MAX_UPLOAD_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? fail("This session is too large to share (limit 15 MB after scrubbing).", 413)
      : fail("The upload was not valid JSON.");
  }
  const body = read.value as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return fail("The upload was empty.");
  try {
    const result = await shareTrace(
      getDb(),
      { config: getConfig(), bus: getBus(), blobs: getBlobs(), search: getSearch() },
      {
        sellerId: user.id,
        trace: body.trace,
        tier: Number(body.tier),
        clientTraits: body.clientTraits as never,
        clientLabels: body.clientLabels as never,
      },
    );
    return NextResponse.json(result);
  } catch (e) {
    return handle(e);
  }
}
