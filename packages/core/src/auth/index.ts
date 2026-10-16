import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { newId, schema, type Db } from "@tm/db";
import type { UserRole } from "@tm/schema";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Version of the data terms shown at onboarding. Bump when the terms change. */
/**
 * The terms every account accepts. v1 added the buying terms (licences, no
 * redistribution, no re-identification), so accounts that accepted v0 (the
 * sharing terms alone) accept again before sharing or buying.
 */
export const TERMS_VERSION = "2026-10-v1";

/** Whether the account has accepted the current terms. */
export function hasCurrentTerms(user: { termsAcceptedVersion: string | null }): boolean {
  return user.termsAcceptedVersion === TERMS_VERSION;
}

const SESSION_DAYS = 7;
const MIN_PASSWORD = 8;

export class AuthError extends Error {}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  buyerOrgId: string | null;
  termsAcceptedVersion: string | null;
}

function toPublic(u: typeof schema.users.$inferSelect): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    buyerOrgId: u.buyerOrgId,
    termsAcceptedVersion: u.termsAcceptedVersion,
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createUser(
  db: Db,
  input: { email: string; password: string; displayName?: string; role: UserRole },
): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AuthError("Enter a valid email address.");
  if (input.password.length < MIN_PASSWORD) {
    throw new AuthError(`Use a password of at least ${MIN_PASSWORD} characters.`);
  }
  if (db.select().from(schema.users).where(eq(schema.users.email, email)).get()) {
    throw new AuthError("An account with this email already exists. Sign in instead.");
  }
  const id = newId("usr");
  const displayName = input.displayName?.trim() || email.split("@")[0]!;
  let buyerOrgId: string | null = null;
  const passwordHash = await hashPassword(input.password);
  db.transaction((tx) => {
    if (input.role === "buyer" || input.role === "both") {
      buyerOrgId = newId("org");
      tx.insert(schema.buyerOrgs)
        .values({ id: buyerOrgId, name: `${displayName}'s team` })
        .run();
    }
    tx.insert(schema.users)
      .values({ id, email, passwordHash, displayName, role: input.role, buyerOrgId })
      .run();
  });
  return toPublic(db.select().from(schema.users).where(eq(schema.users.id, id)).get()!);
}

export async function authenticate(db: Db, email: string, password: string): Promise<PublicUser> {
  const u = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .get();
  if (!u || !(await verifyPassword(password, u.passwordHash))) {
    throw new AuthError("Email or password is incorrect.");
  }
  return toPublic(u);
}

export function acceptTerms(db: Db, userId: string, version: string = TERMS_VERSION): void {
  db.update(schema.users)
    .set({ termsAcceptedVersion: version })
    .where(eq(schema.users.id, userId))
    .run();
}

// Sessions: the browser holds a random token; the database stores only its hash.
const tokenHash = (token: string) => createHash("sha256").update(token).digest("base64url");

export function createSession(db: Db, userId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  db.insert(schema.authSessions)
    .values({ id: tokenHash(token), userId, expiresAt })
    .run();
  return { token, expiresAt };
}

export function getUserBySession(db: Db, token: string | undefined, now = new Date()) {
  if (!token) return undefined;
  const row = db
    .select()
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
    .where(eq(schema.authSessions.id, tokenHash(token)))
    .get();
  if (!row || row.auth_sessions.expiresAt.getTime() <= now.getTime()) return undefined;
  return toPublic(row.users);
}

export function deleteSession(db: Db, token: string): void {
  db.delete(schema.authSessions)
    .where(eq(schema.authSessions.id, tokenHash(token)))
    .run();
}

export function canSell(u: PublicUser): boolean {
  return u.role === "seller" || u.role === "both" || u.role === "admin";
}
