import "server-only";
import { NextResponse } from "next/server";
import { AuthError, createSession, ShareError } from "@tm/core";
import { getDb, SESSION_COOKIE } from "./server";

/** JSON error with a message the UI can show as-is. */
export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Turn known domain errors into 400s; anything else is a 500. */
export function handle(err: unknown) {
  if (err instanceof AuthError || err instanceof ShareError) return fail(err.message, 400);
  console.error(err);
  return fail("Something went wrong on our side. Try again.", 500);
}

export function withSession(res: NextResponse, userId: string) {
  const { token, expiresAt } = createSession(getDb(), userId);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // HTTPS-only in production. TM_COOKIE_SECURE=0 allows plain HTTP for a
    // trial on a private network (see docs/DEPLOYING.md); never on the internet.
    secure: process.env.NODE_ENV === "production" && process.env.TM_COOKIE_SECURE !== "0",
    path: "/",
    expires: expiresAt,
  });
  return res;
}
