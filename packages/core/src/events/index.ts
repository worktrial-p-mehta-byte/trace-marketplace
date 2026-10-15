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
}

/** v0 implementation: an outbox table in the main database, polled in-process. */
export function createDbEventBus(db: Db): EventBus {
  return {
    emit(type, payload) {
      const [row] = db
        .insert(schema.events)
        .values({ type, payload })
        .returning({ seq: schema.events.seq })
        .all();
      return row!.seq;
    },

    poll(consumer, handler, limit = 100) {
      return db.transaction((tx) => {
        tx.insert(schema.eventCursors).values({ consumer, lastSeq: 0 }).onConflictDoNothing().run();
        const cursor = tx
          .select()
          .from(schema.eventCursors)
          .where(eq(schema.eventCursors.consumer, consumer))
          .get()!;
        const batch = tx
          .select({
            seq: schema.events.seq,
            type: schema.events.type,
            payload: schema.events.payload,
          })
          .from(schema.events)
          .where(gt(schema.events.seq, cursor.lastSeq))
          .orderBy(asc(schema.events.seq))
          .limit(limit)
          .all();
        for (const e of batch) handler(e);
        const last = batch.at(-1);
        if (last) {
          tx.update(schema.eventCursors)
            .set({ lastSeq: sql`${last.seq}` })
            .where(eq(schema.eventCursors.consumer, consumer))
            .run();
        }
        return batch.length;
      });
    },
  };
}
