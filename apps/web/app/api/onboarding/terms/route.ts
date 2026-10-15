import { NextResponse } from "next/server";
import { acceptTerms, TERMS_VERSION } from "@tm/core";
import { fail } from "@/lib/api";
import { getCurrentUser, getDb } from "@/lib/server";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Sign in first.", 401);
  const body = (await req.json().catch(() => null)) as { accept?: boolean } | null;
  if (!body?.accept) return fail("Tick the box to accept the data terms.");
  acceptTerms(getDb(), user.id, TERMS_VERSION);
  return NextResponse.json({ ok: true, version: TERMS_VERSION });
}
