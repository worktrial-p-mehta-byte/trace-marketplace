import { and, desc, eq, isNull } from "drizzle-orm";
import { newId, schema, type Db } from "@tm/db";

/** In-app notifications. Kinds: "sale", "campaign" (a new campaign matching a seller's domains). */
export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export function notify(
  db: Pick<Db, "insert">,
  userId: string,
  n: { kind: string; title: string; body: string; href?: string; now?: Date },
): string {
  const id = newId("ntf");
  db.insert(schema.notifications)
    .values({
      id,
      userId,
      kind: n.kind,
      title: n.title.slice(0, 200),
      body: n.body.slice(0, 1000),
      href: n.href,
      createdAt: n.now ?? new Date(),
    })
    .run();
  return id;
}

export function listNotifications(db: Db, userId: string, limit = 50): Notification[] {
  return db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(limit)
    .all();
}

export function unreadCount(db: Db, userId: string): number {
  return db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
    .all().length;
}

export function markAllRead(db: Db, userId: string, now = new Date()): void {
  db.update(schema.notifications)
    .set({ readAt: now })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
    .run();
}
