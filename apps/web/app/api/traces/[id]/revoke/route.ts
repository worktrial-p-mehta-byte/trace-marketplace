import { NextResponse } from "next/server";
import { revokeTrace } from "@tm/core";
import { fail, handle } from "@/lib/api";
import { getBlobs, getBus, getConfig, getCurrentUser, getDb, getSearch } from "@/lib/server";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await ctx.params;
  try {
    await revokeTrace(
      getDb(),
      { config: getConfig(), bus: getBus(), blobs: getBlobs(), search: getSearch() },
      user.id,
      id,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}
