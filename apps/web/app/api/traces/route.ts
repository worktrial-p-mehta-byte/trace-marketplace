import { NextResponse } from "next/server";
import { canSell, shareTrace } from "@tm/core";
import { fail, handle } from "@/lib/api";
import { getBlobs, getBus, getConfig, getCurrentUser, getDb } from "@/lib/server";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) {
    return fail("This session is too large to share (limit 15 MB after scrubbing).", 413);
  }
  const user = await getCurrentUser();
  if (!user) return fail("Sign in to share traces.", 401);
  if (!canSell(user)) return fail("Your account is set up for buying only.", 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("The upload was empty.");
  try {
    const result = await shareTrace(
      getDb(),
      { config: getConfig(), bus: getBus(), blobs: getBlobs() },
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
