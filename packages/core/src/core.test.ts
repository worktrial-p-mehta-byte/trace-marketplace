import { beforeEach, describe, expect, it } from "vitest";
import { openDb, runMigrations, type Db } from "@tm/db";
import {
  Accounts,
  assertBalanced,
  balanceOf,
  createDbEventBus,
  EventTypes,
  isTierSupported,
  postTransaction,
  splitSale,
  UnbalancedTransactionError,
} from "./index";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
  runMigrations(db);
});

describe("ledger", () => {
  it("rejects unbalanced transactions", () => {
    expect(() =>
      assertBalanced([
        { account: "a", amountCents: 100 },
        { account: "b", amountCents: -99 },
      ]),
    ).toThrow(UnbalancedTransactionError);
  });

  it("rejects fractional cents", () => {
    expect(() =>
      assertBalanced([
        { account: "a", amountCents: 0.5 },
        { account: "b", amountCents: -0.5 },
      ]),
    ).toThrow(/integer cents/);
  });

  it("records a sale split and reports balances", () => {
    const { seller, platform } = splitSale(2273, 0.7);
    expect(seller + platform).toBe(2273);
    postTransaction(db, {
      kind: "credit_grant",
      lines: [
        { account: Accounts.creditIssuer, amountCents: -10_000 },
        { account: Accounts.buyer("org1"), amountCents: 10_000 },
      ],
    });
    postTransaction(db, {
      kind: "sale",
      lines: [
        { account: Accounts.buyer("org1"), amountCents: -2273 },
        { account: Accounts.seller("u1"), amountCents: seller },
        { account: Accounts.platformFees, amountCents: platform },
      ],
    });
    expect(balanceOf(db, Accounts.buyer("org1"))).toBe(10_000 - 2273);
    expect(balanceOf(db, Accounts.seller("u1"))).toBe(1592);
    expect(balanceOf(db, Accounts.platformFees)).toBe(681);
  });
});

describe("event bus", () => {
  it("delivers each event once per consumer, in order", () => {
    const bus = createDbEventBus(db);
    bus.emit(EventTypes.TraceIngested, { traceId: "t1" });
    bus.emit(EventTypes.ListingCreated, { listingId: "l1" });

    const seenA: string[] = [];
    expect(bus.poll("pricing", (e) => seenA.push(e.type))).toBe(2);
    expect(bus.poll("pricing", (e) => seenA.push(e.type))).toBe(0);
    expect(seenA).toEqual(["trace.ingested", "listing.created"]);

    const seenB: string[] = [];
    bus.poll("search", (e) => seenB.push(e.type));
    expect(seenB).toHaveLength(2);
  });

  it("redelivers peeked events until they are acknowledged", () => {
    const bus = createDbEventBus(db);
    const a = bus.emit(EventTypes.TraceIngested, { traceId: "t1" });
    const b = bus.emit(EventTypes.ListingCreated, { listingId: "l1" });

    expect(bus.peek("pricing").map((e) => e.seq)).toEqual([a, b]);
    expect(bus.peek("pricing").map((e) => e.seq)).toEqual([a, b]);
    bus.ack("pricing", a);
    expect(bus.peek("pricing").map((e) => e.seq)).toEqual([b]);
    bus.ack("pricing", b);
    bus.ack("pricing", a); // never moves backwards
    expect(bus.peek("pricing")).toEqual([]);
  });

  it("leaves the cursor in place when a poll handler throws", () => {
    const bus = createDbEventBus(db);
    bus.emit(EventTypes.TraceIngested, { traceId: "t1" });
    expect(() =>
      bus.poll("pricing", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(bus.peek("pricing")).toHaveLength(1);
  });
});

describe("policy", () => {
  it("allows only tiers 0 and 1 in v0", () => {
    expect(isTierSupported(0)).toBe(true);
    expect(isTierSupported(1)).toBe(true);
    expect(isTierSupported(3)).toBe(false);
  });
});
