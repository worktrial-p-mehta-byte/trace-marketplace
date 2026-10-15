import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { parseClaudeCodeSession } from "@tm/adapters";
import { loadConfig } from "@tm/config";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { enrichTrace } from "@tm/enrich";
import { scrubTrace, toSignalsOnly } from "@tm/scrub";
import type { Trace } from "@tm/schema";
import {
  acceptTerms,
  authenticate,
  AuthError,
  createDbEventBus,
  createMemoryBlobStore,
  createSession,
  createUser,
  deleteSession,
  estimatePrice,
  getUserBySession,
  listSellerTraces,
  revokeTrace,
  shareTrace,
  ShareError,
  type CatalogDeps,
} from "../index";

const FIXTURE = fileURLToPath(
  new URL("../../../../fixtures/claude-code/synthetic-session.jsonl", import.meta.url),
);
const raw = parseClaudeCodeSession(readFileSync(FIXTURE, "utf8")).traces[0]!;
const NOW = new Date("2026-10-15T12:00:00Z");

let db: Db;
let deps: CatalogDeps & { blobs: ReturnType<typeof createMemoryBlobStore> };
let sellerId: string;

beforeEach(async () => {
  db = openDb(":memory:");
  runMigrations(db);
  deps = {
    config: loadConfig(),
    bus: createDbEventBus(db),
    blobs: createMemoryBlobStore(),
    now: NOW,
  };
  const u = await createUser(db, {
    email: "Seller@Example.com",
    password: "correct horse",
    role: "seller",
  });
  acceptTerms(db, u.id);
  sellerId = u.id;
});

describe("accounts and sessions", () => {
  it("creates users with normalised emails and hashed passwords", async () => {
    const row = db.select().from(schema.users).where(eq(schema.users.id, sellerId)).get()!;
    expect(row.email).toBe("seller@example.com");
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain("correct horse");
    await expect(authenticate(db, "SELLER@example.com", "correct horse")).resolves.toMatchObject({
      id: sellerId,
    });
    await expect(authenticate(db, "seller@example.com", "wrong")).rejects.toThrow(AuthError);
  });

  it("rejects duplicate emails, bad emails and short passwords", async () => {
    await expect(
      createUser(db, { email: "seller@example.com", password: "12345678", role: "seller" }),
    ).rejects.toThrow(/already exists/);
    await expect(
      createUser(db, { email: "nope", password: "12345678", role: "seller" }),
    ).rejects.toThrow(/valid email/);
    await expect(
      createUser(db, { email: "a@b.co", password: "short", role: "seller" }),
    ).rejects.toThrow(/at least 8/);
  });

  it("gives buyers an organisation", async () => {
    const b = await createUser(db, {
      email: "lab@example.com",
      password: "12345678",
      role: "buyer",
    });
    expect(b.buyerOrgId).toMatch(/^org_/);
  });

  it("stores only a hash of the session token, and expires sessions", () => {
    const { token } = createSession(db, sellerId, NOW);
    expect(db.select().from(schema.authSessions).all()[0]!.id).not.toBe(token);
    expect(getUserBySession(db, token, NOW)?.id).toBe(sellerId);
    expect(getUserBySession(db, token, new Date(NOW.getTime() + 8 * 86_400_000))).toBeUndefined();
    deleteSession(db, token);
    expect(getUserBySession(db, token, NOW)).toBeUndefined();
    expect(getUserBySession(db, undefined)).toBeUndefined();
  });
});

describe("shareTrace", () => {
  const scrubbed = () => scrubTrace(raw).trace;

  it("stores, labels, lists and prices an open-source trace", async () => {
    const r = await shareTrace(db, deps, { sellerId, trace: scrubbed(), tier: 0 });
    expect(r.priceCents).toBeGreaterThan(0);
    expect(r.sellerCents).toBe(Math.ceil(r.priceCents * 0.7));
    expect(r.labels).toContain("test_tampering");
    expect(deps.blobs.keys()).toEqual([`traces/${r.traceId}.json`]);
    const consent = db.select().from(schema.consents).all()[0]!;
    expect(consent).toMatchObject({ tier: 0, termsVersion: "2026-10-v0", revokedAt: null });
    expect(db.select().from(schema.listings).all()[0]!.status).toBe("active");
  });

  it("scrubs again on the server even if the browser did not", async () => {
    const leaky: Trace = {
      ...raw,
      events: raw.events.map((e) =>
        e.seq === 2 && e.type === "user_message" ? { ...e, text: "my email is me@acme.io" } : e,
      ),
    };
    const r = await shareTrace(db, deps, { sellerId, trace: leaky, tier: 0 });
    const stored = await deps.blobs.get(`traces/${r.traceId}.json`);
    expect(stored).not.toContain("me@acme.io");
    expect(stored).toContain("[REDACTED:email]");
  });

  it("stores no content for signals-only, using bounded browser-reported traits", async () => {
    const full = scrubbed();
    const e = enrichTrace(full);
    const r = await shareTrace(db, deps, {
      sellerId,
      trace: toSignalsOnly(full),
      tier: 1,
      clientTraits: { ...e.traits, userCorrections: 999 },
      clientLabels: e.labels,
    });
    const stored = (await deps.blobs.get(`traces/${r.traceId}.json`))!;
    expect(stored).not.toContain("parseDueDate");
    const traits = db.select().from(schema.traceTraits).all()[0]!.data as {
      userCorrections: number;
      turns: number;
    };
    expect(traits.userCorrections).toBeLessThanOrEqual(traits.turns);
    expect(db.select().from(schema.assets).all()[0]!.kind).toBe("signals");
  });

  it("refuses sessions with no model output, duplicates, synthetic uploads and missing terms", async () => {
    const empty: Trace = { ...raw, events: [{ seq: 0, type: "user_message", text: "hello?" }] };
    await expect(shareTrace(db, deps, { sellerId, trace: empty, tier: 0 })).rejects.toThrow(
      /no replies/,
    );

    await shareTrace(db, deps, { sellerId, trace: scrubbed(), tier: 0 });
    await expect(shareTrace(db, deps, { sellerId, trace: scrubbed(), tier: 0 })).rejects.toThrow(
      /already shared/,
    );

    const synthetic = { ...raw, provenance: { ...raw.provenance, source: "synthetic" as const } };
    await expect(shareTrace(db, deps, { sellerId, trace: synthetic, tier: 0 })).rejects.toThrow(
      ShareError,
    );

    const other = await createUser(db, {
      email: "new@example.com",
      password: "12345678",
      role: "seller",
    });
    await expect(
      shareTrace(db, deps, { sellerId: other.id, trace: scrubbed(), tier: 0 }),
    ).rejects.toThrow(/data terms/);
    await expect(shareTrace(db, deps, { sellerId, trace: { nope: 1 }, tier: 0 })).rejects.toThrow(
      /valid trace/,
    );
    await expect(shareTrace(db, deps, { sellerId, trace: scrubbed(), tier: 3 })).rejects.toThrow(
      /open source/,
    );
  });
});

describe("revokeTrace and listSellerTraces", () => {
  it("delists a revoked trace, records the date and allows sharing again", async () => {
    const r = await shareTrace(db, deps, { sellerId, trace: scrubTrace(raw).trace, tier: 0 });
    let rows = listSellerTraces(db, sellerId, deps.config);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", tier: 0, revokedAt: null });
    expect(rows[0]!.labels).toContain("test_tampering");

    revokeTrace(db, deps, sellerId, r.traceId);
    rows = listSellerTraces(db, sellerId, deps.config);
    expect(rows[0]).toMatchObject({ status: "delisted" });
    expect(rows[0]!.revokedAt).toEqual(NOW);

    expect(() => revokeTrace(db, deps, "someone-else", r.traceId)).toThrow(/not found/);
    await expect(
      shareTrace(db, deps, { sellerId, trace: scrubTrace(raw).trace, tier: 0 }),
    ).resolves.toBeDefined();
  });
});

describe("estimatePrice", () => {
  it("prices unlisted traits against the current market without writing", () => {
    const { traits } = enrichTrace(scrubTrace(raw).trace);
    const q = estimatePrice(db, deps, { ...traits, capturedAt: NOW.toISOString() }, 0);
    expect(q.priceCents).toBeGreaterThan(0);
    expect(q.drivers.find((d) => d.factor === "failure")!.reason).toMatch(/tampered/);
    expect(db.select().from(schema.priceSnapshots).all()).toEqual([]);
  });
});
