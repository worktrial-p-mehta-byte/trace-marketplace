import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { findRepoRoot } from "@tm/config/server";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");

/** Open (or create) a SQLite database. Pass ":memory:" for tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema }) as Db;
}

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

/**
 * The migrations folder, or undefined when it can't be found. Bundled code
 * (the Next server) doesn't sit next to the package, so the repo root (from
 * TM_ROOT, or found from the working directory, as the config does) and the
 * repo layout from the working directory are tried too.
 */
export function findMigrationsDir(
  cwd = process.cwd(),
  packageDir: string = MIGRATIONS_DIR,
): string | undefined {
  const candidates = [
    packageDir,
    join(findRepoRoot(cwd), "packages", "db", "drizzle"),
    resolve(cwd, "packages/db/drizzle"),
    resolve(cwd, "../../packages/db/drizzle"),
  ];
  return candidates.find((d) => existsSync(join(d, "meta", "_journal.json")));
}

/**
 * Migrations in the folder that this database hasn't applied yet, oldest
 * first (by tag, e.g. "0003_campaigns_notifications"). Drizzle applies every
 * migration newer than the last one recorded, so the same rule is used here.
 */
export function pendingMigrations(db: Db, folder = MIGRATIONS_DIR): string[] {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string; when: number }[];
  };
  const hasTable = db.$client
    .prepare("select 1 from sqlite_master where type='table' and name='__drizzle_migrations'")
    .get();
  const last = hasTable
    ? ((
        db.$client.prepare("select max(created_at) as last from __drizzle_migrations").get() as {
          last: number | null;
        }
      ).last ?? -Infinity)
    : -Infinity;
  return journal.entries.filter((e) => e.when > last).map((e) => e.tag);
}
