import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession } from "@tm/core";
import { getDb, SESSION_COOKIE } from "@/lib/server";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(getDb(), token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
