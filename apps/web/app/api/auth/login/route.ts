import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, hasCurrentTerms } from "@tm/core";
import { fail, handle, withSession } from "@/lib/api";
import { getDb } from "@/lib/server";

const Body = z.object({ email: z.string(), password: z.string() });

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("Enter your email and password.");
  try {
    const user = await authenticate(getDb(), body.data.email, body.data.password);
    return withSession(NextResponse.json({ user, termsCurrent: hasCurrentTerms(user) }), user.id);
  } catch (e) {
    return handle(e);
  }
}
