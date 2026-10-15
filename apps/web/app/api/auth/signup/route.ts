import { NextResponse } from "next/server";
import { z } from "zod";
import { createUser } from "@tm/core";
import { fail, handle, withSession } from "@/lib/api";
import { getDb } from "@/lib/server";

const Body = z.object({
  email: z.string(),
  password: z.string(),
  displayName: z.string().optional(),
  role: z.enum(["seller", "buyer", "both"]),
});

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return fail("Fill in your email, a password and how you'll use the marketplace.");
  try {
    const user = await createUser(getDb(), body.data);
    return withSession(NextResponse.json({ user }), user.id);
  } catch (e) {
    return handle(e);
  }
}
