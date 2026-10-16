import { describe, expect, it } from "vitest";
import { openDb, runMigrations } from "./client";

const EXPECTED_TABLES = [
  "assets",
  "auth_sessions",
  "bounties",
  "bounty_submissions",
  "buyer_orgs",
  "campaign_fills",
  "campaigns",
  "collection_items",
  "collection_snapshots",
  "collections",
  "consents",
  "demand_signals",
  "entitlements",
  "event_cursors",
  "events",
  "labels",
  "ledger_entries",
  "ledger_transactions",
  "licenses",
  "listing_search",
  "listings",
  "notifications",
  "order_lines",
  "orders",
  "price_snapshots",
  "quotes",
  "seller_interests",
  "trace_traits",
  "traces",
  "users",
];

describe("database migrations", () => {
  it("create every table in the data model", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    const rows = db.$client
      .prepare(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%' and name not like 'listing\\_search\\_%' escape '\\' order by name",
      )
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES);
    db.$client.close();
  });

  it("are idempotent", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    db.$client.close();
  });

  it("enforce foreign keys", () => {
    const db = openDb(":memory:");
    runMigrations(db);
    expect(() =>
      db.$client
        .prepare(
          "insert into consents (id, trace_id, seller_id, tier, scope, terms_version, granted_at) values ('c1','missing','missing',0,'session','v1',0)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    db.$client.close();
  });
});
