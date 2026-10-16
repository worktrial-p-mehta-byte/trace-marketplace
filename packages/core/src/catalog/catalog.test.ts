import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { parseClaudeCodeSession } from "@tm/adapters";
import { loadConfig } from "@tm/config";
import { openDb, runMigrations, schema, type Db } from "@tm/db";
import { enrichTrace } from "@tm/enrich";
import { placeholderDensity, scrubTrace, toSignalsOnly } from "@tm/scrub";
import type { Trace } from "@tm/schema";
import { generateFlood } from "@tm/synth";
import {
  acceptTerms,
  authenticate,
  AuthError,
  createMemoryBlobStore,
  createDbEventBus,
  createSession,
  createUser,
  deleteSession,
  contentHashOf,
  DuplicateShareError,
  legacyContentHashOf,
  estimatePrice,
  getUserBySession,
  listSellerTraces,
  revokeTrace,
  runPricingConsumer,
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

  it("keeps a signals-only upload's domain as a bounded claim", async () => {
    const full = scrubbed();
    const e = enrichTrace(full);
    const share = (clientTraits: object) =>
      shareTrace(
        db,
        deps,
        { sellerId, trace: toSignalsOnly(full), tier: 1, clientTraits, clientLabels: e.labels },
        {},
      );
    await share({
      ...e.traits,
      domain: "legal",
      domainConfidence: 7,
      domains: [{ domain: "legal", share: 3 }, { domain: "astrology", share: 0.5 }, null],
    });
    const stored = () =>
      db.select().from(schema.traceTraits).all().at(-1)!.data as {
        domain: string;
        domainConfidence: number;
        domains: { domain: string; share: number }[];
      };
    expect(stored()).toMatchObject({
      domain: "legal",
      domainConfidence: 1,
      domains: [{ domain: "legal", share: 1 }],
    });
    // A made-up domain is not a facet value: it becomes unknown.
    db.update(schema.consents).set({ revokedAt: new Date() }).run();
    await share({ ...e.traits, domain: "astrology", domainConfidence: 0.9 });
    expect(stored()).toMatchObject({ domain: "unknown", domainConfidence: 0 });
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

describe("shareTrace under concurrency", () => {
  it("lets only one of two simultaneous uploads of the same session through", async () => {
    const trace = scrubTrace(raw).trace;
    const results = await Promise.allSettled([
      shareTrace(db, deps, { sellerId, trace, tier: 0 }),
      shareTrace(db, deps, { sellerId, trace, tier: 0 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ShareError);
    expect(db.select().from(schema.listings).all()).toHaveLength(1);
    expect(deps.blobs.keys()).toHaveLength(1); // the loser's blob is cleaned up
  });
});

describe("estimate matches the shared price", () => {
  it("uses the same redaction measure as the server, even for a long private key", async () => {
    // A long secret shrinks to one short placeholder: "characters removed" and
    // "placeholders left" disagree, so both sides must use the same measure.
    const key =
      "-----BEGIN RSA PRIVATE KEY-----\n" + "A".repeat(4000) + "\n-----END RSA PRIVATE KEY-----"; // tm-allow-secret
    const withKey: Trace = {
      ...raw,
      events: raw.events.map((e) =>
        e.seq === 2 && e.type === "user_message" ? { ...e, text: `use this key:\n${key}` } : e,
      ),
    };
    const scrubbed = scrubTrace(withKey);
    expect(scrubbed.stats.density).toBeGreaterThan(0.2); // removed-characters view: penalised
    expect(placeholderDensity(scrubbed.trace)).toBeLessThan(0.2); // placeholders-left view: not
    const { traits } = enrichTrace(scrubbed.trace, {
      redactionDensity: placeholderDensity(scrubbed.trace),
    });
    const estimate = estimatePrice(db, deps, traits, 0);
    const shared = await shareTrace(db, deps, { sellerId, trace: scrubbed.trace, tier: 0 });
    expect(shared.priceCents).toBe(estimate.priceCents);
  });
});

describe("shareTrace when downstream work fails", () => {
  it("keeps a committed upload successful and recoverable if pricing throws", async () => {
    // A bus whose consumers fail (e.g. a repricing or database error), while
    // emitting still works.
    const real = createDbEventBus(db);
    const broken = {
      emit: real.emit,
      ack: real.ack,
      poll: () => {
        throw new Error("repricer down");
      },
      peek: () => {
        throw new Error("repricer down");
      },
    };
    const quiet = console.error;
    console.error = () => {};
    const r = await shareTrace(
      db,
      { ...deps, bus: broken },
      { sellerId, trace: scrubTrace(raw).trace, tier: 0 },
    ).finally(() => (console.error = quiet));
    expect(r.pricePending).toBe(true);
    expect(r.listingId).toBeTruthy();

    // A retry is refused as a duplicate: the first upload really is listed.
    await expect(
      shareTrace(db, deps, { sellerId, trace: scrubTrace(raw).trace, tier: 0 }),
    ).rejects.toThrow(ShareError);

    // The events were committed with the listing, so the next run prices it.
    runPricingConsumer(db, real, { config: deps.config, now: NOW });
    const listing = db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, r.listingId))
      .get()!;
    expect(listing.currentPriceCents).toBeGreaterThan(0);
  });
});

describe("duplicate shares of signals-only traces", () => {
  it("accepts two different sessions that only differ in their text", async () => {
    // The same story in another language: same steps and timing, other words.
    const a = scrubTrace(raw).trace;
    const b: Trace = {
      ...a,
      id: `${a.id}_other`,
      events: a.events.map((e) =>
        e.type === "user_message" || e.type === "assistant_message"
          ? { ...e, text: `${e.text} (in Verilog)` }
          : e,
      ),
    };
    // Stripped of text, the two are indistinguishable by their events alone.
    expect(JSON.stringify(toSignalsOnly(a).events)).toBe(JSON.stringify(toSignalsOnly(b).events));

    await shareTrace(db, deps, { sellerId, trace: toSignalsOnly(a), tier: 1 });
    await expect(
      shareTrace(db, deps, { sellerId, trace: toSignalsOnly(b), tier: 1 }),
    ).resolves.toMatchObject({ listingId: expect.any(String) });

    // Re-uploading the same session is still refused.
    await expect(
      shareTrace(db, deps, { sellerId, trace: toSignalsOnly(a), tier: 1 }),
    ).rejects.toThrow(DuplicateShareError);
  });

  it("upgrades signals-only rows stored with the events-only hash before judging duplicates", async () => {
    // Two different sessions, byte-identical once stripped (as above).
    const a = { ...scrubTrace(raw).trace, id: "cc_session_a" };
    const b = {
      ...a,
      id: "cc_session_b",
      events: a.events.map((e) =>
        e.type === "user_message" ? { ...e, text: e.text.replace("parseDueDate", "b") } : e,
      ),
    };
    const shared = await shareTrace(db, deps, { sellerId, trace: toSignalsOnly(a), tier: 1 });
    // A row written before the format change carries the events-only hash.
    db.update(schema.traces)
      .set({ contentHash: legacyContentHashOf(toSignalsOnly(a)) })
      .where(eq(schema.traces.id, shared.traceId))
      .run();

    // B is a different session, so it lists, and A's row is upgraded from its own blob.
    await expect(
      shareTrace(db, deps, { sellerId, trace: toSignalsOnly(b), tier: 1 }),
    ).resolves.toMatchObject({ listingId: expect.any(String) });
    const row = db.select().from(schema.traces).where(eq(schema.traces.id, shared.traceId)).get()!;
    expect(row.contentHash).toBe(contentHashOf(toSignalsOnly(a), 1));
    // A itself is still a duplicate.
    await expect(
      shareTrace(db, deps, { sellerId, trace: toSignalsOnly(a), tier: 1 }),
    ).rejects.toThrow(DuplicateShareError);
  });

  it("ignores a changed trace id when the content itself is re-uploaded as open source", async () => {
    const trace = scrubTrace(raw).trace;
    await shareTrace(db, deps, { sellerId, trace, tier: 0 });
    await expect(
      shareTrace(db, deps, { sellerId, trace: { ...trace, id: "cc_renamed" }, tier: 0 }),
    ).rejects.toThrow(DuplicateShareError);
  });
});

describe("runPricingConsumer after a failed reprice", () => {
  it("retries on the next run instead of waiting for the scheduled refresh", async () => {
    // A recent full reprice exists, so the stale-price fallback would not fire.
    runPricingConsumer(db, deps.bus, { config: deps.config, now: NOW });

    // Repricing fails transiently while the share commits.
    db.$client.exec("ALTER TABLE price_snapshots RENAME TO price_snapshots_down");
    const quiet = console.error;
    console.error = () => {};
    const r = await shareTrace(db, deps, {
      sellerId,
      trace: scrubTrace(raw).trace,
      tier: 0,
    }).finally(() => (console.error = quiet));
    db.$client.exec("ALTER TABLE price_snapshots_down RENAME TO price_snapshots");
    expect(r.pricePending).toBe(true);

    // Same logical time, so only the unacknowledged events can trigger this.
    const result = runPricingConsumer(db, deps.bus, { config: deps.config, now: NOW });
    expect(result?.changed).toBe(1);
    const listing = db
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, r.listingId))
      .get()!;
    expect(listing.currentPriceCents).toBeGreaterThan(0);
  });
});

describe("revokeTrace and listSellerTraces", () => {
  it("delists a revoked trace, records the date and allows sharing again", async () => {
    const r = await shareTrace(db, deps, { sellerId, trace: scrubTrace(raw).trace, tier: 0 });
    let rows = listSellerTraces(db, sellerId, deps.config);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", tier: 0, revokedAt: null });
    expect(rows[0]!.labels).toContain("test_tampering");

    await revokeTrace(db, deps, sellerId, r.traceId);
    rows = listSellerTraces(db, sellerId, deps.config);
    expect(rows[0]).toMatchObject({ status: "delisted" });
    expect(rows[0]!.revokedAt).toEqual(NOW);

    await expect(revokeTrace(db, deps, "someone-else", r.traceId)).rejects.toThrow(/not found/);
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

  it("matches the listed price for a new combination in a skewed small market", async () => {
    // Existing combination counts [1, 3]: the old median (2) made an unseen
    // combination look twice as rare as it is once listed (median 1).
    // The model is part of the combination, so pin it.
    const pin = (t: Trace): Trace => ({
      ...t,
      provenance: { ...t.provenance, model: { id: "claude-test-model" } },
    });
    const seed = [
      ...generateFlood(1, 1, NOW, { language: "Go", pattern: "tool_error" }),
      ...generateFlood(2, 3, NOW, { language: "Rust", framework: "Tokio", pattern: "retry_loop" }),
    ].map(pin);
    for (const t of seed) {
      await shareTrace(db, deps, { sellerId, trace: t, tier: 0 }, { allowSynthetic: true });
    }
    const scrubbed = scrubTrace(raw);
    const { traits } = enrichTrace(scrubbed.trace, {
      redactionDensity: placeholderDensity(scrubbed.trace),
    });
    const estimate = estimatePrice(db, deps, traits, 0);
    const shared = await shareTrace(db, deps, { sellerId, trace: scrubbed.trace, tier: 0 });
    expect(shared.priceCents).toBe(estimate.priceCents);
  });
});
