import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import {
  findMigrationsDir,
  MIGRATIONS_DIR,
  openDb,
  pendingMigrations,
  runMigrations,
} from "./client";

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

  it("report what an older database is missing, and nothing once migrated", () => {
    // A database migrated before the last two migrations existed.
    const old = mkdtempSync(join(tmpdir(), "tm-migrations-"));
    try {
      cpSync(MIGRATIONS_DIR, old, { recursive: true });
      const journalPath = join(old, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { tag: string }[];
      };
      const all = journal.entries.map((e) => e.tag);
      journal.entries = journal.entries.slice(0, -2);
      writeFileSync(journalPath, JSON.stringify(journal));
      const db = openDb(":memory:");
      expect(pendingMigrations(db)).toEqual(all);
      migrate(db, { migrationsFolder: old });
      expect(pendingMigrations(db)).toEqual(all.slice(-2));
      runMigrations(db);
      expect(pendingMigrations(db)).toEqual([]);
      db.$client.close();
    } finally {
      rmSync(old, { recursive: true, force: true });
    }
  });

  it("finds the migrations folder from the package or the repo layout", () => {
    expect(findMigrationsDir()).toBeDefined();
    expect(findMigrationsDir("/nonexistent")).toBe(MIGRATIONS_DIR);
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
