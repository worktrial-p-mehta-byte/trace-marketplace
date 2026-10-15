import { NextResponse } from "next/server";
import { revokeTrace } from "@tm/core";
import { fail, handle } from "@/lib/api";
import { getBus, getConfig, getCurrentUser, getDb } from "@/lib/server";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.", 401);
  const { id } = await ctx.params;
  try {
    revokeTrace(getDb(), { config: getConfig(), bus: getBus() }, user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handle(e);
  }
}
