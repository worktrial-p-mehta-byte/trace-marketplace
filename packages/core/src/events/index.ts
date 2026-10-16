import { asc, eq, gt, sql } from "drizzle-orm";
import { schema, type Db } from "@tm/db";

/**
 * Event types every module may emit. New features subscribe to these
 * instead of being called directly.
 */
export const EventTypes = {
  TraceIngested: "trace.ingested",
  TraceLabeled: "trace.labeled",
  ListingCreated: "listing.created",
  ListingDelisted: "listing.delisted",
  ConsentRevoked: "consent.revoked",
  PriceUpdated: "price.updated",
  /** A full reprice ran (whether or not anything changed); payload.at is its logical time. */
  PricesRefreshed: "prices.refreshed",
  DemandSignaled: "demand.signaled",
  OrderPaid: "order.paid",
  BountyPosted: "bounty.posted",
  BountyMatched: "bounty.matched",
  /** The demo seed finished (scripts/seed.ts); its absence after a seed means it stopped part-way. */
  DemoSeeded: "demo.seeded",
} as const;
export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export interface StoredEvent {
  seq: number;
  type: string;
  payload: unknown;
}

/** The seam a real queue (SQS, Kafka) will implement later. */
export interface EventBus {
  emit(type: EventType, payload: unknown): number;
  /** Deliver events after this consumer's cursor, then advance it. Returns how many were handled. */
  poll(consumer: string, handler: (e: StoredEvent) => void, limit?: number): number;
  /**
   * Read events after this consumer's cursor without advancing it. Pair with
   * `ack` once the work they trigger has succeeded, so a failure part-way
   * leaves the events to be delivered again (at-least-once).
   */
  peek(consumer: string, limit?: number): StoredEvent[];
  /** Advance this consumer's cursor to `seq`. Never moves it backwards. */
  ack(consumer: string, seq: number): void;
}

/** v0 implementation: an outbox table in the main database, polled in-process. */
export function createDbEventBus(db: Db): EventBus {
  const bus: EventBus = {
    emit(type, payload) {
      const [row] = db
        .insert(schema.events)
        .values({ type, payload })
        .returning({ seq: schema.events.seq })
        .all();
      return row!.seq;
    },

    peek(consumer, limit = 100) {
      const cursor = db
        .select({ lastSeq: schema.eventCursors.lastSeq })
        .from(schema.eventCursors)
        .where(eq(schema.eventCursors.consumer, consumer))
        .get();
      return db
        .select({
          seq: schema.events.seq,
          type: schema.events.type,
          payload: schema.events.payload,
        })
        .from(schema.events)
        .where(gt(schema.events.seq, cursor?.lastSeq ?? 0))
        .orderBy(asc(schema.events.seq))
        .limit(limit)
        .all();
    },

    ack(consumer, seq) {
      db.insert(schema.eventCursors)
        .values({ consumer, lastSeq: seq })
        .onConflictDoUpdate({
          target: schema.eventCursors.consumer,
          set: { lastSeq: sql`max(${schema.eventCursors.lastSeq}, ${seq})` },
        })
        .run();
    },

    poll(consumer, handler, limit = 100) {
      // One transaction: if a handler throws, the cursor stays put.
      return db.transaction(() => {
        const batch = bus.peek(consumer, limit);
        for (const e of batch) handler(e);
        const last = batch.at(-1);
        if (last) bus.ack(consumer, last.seq);
        return batch.length;
      });
    },
  };
  return bus;
}
