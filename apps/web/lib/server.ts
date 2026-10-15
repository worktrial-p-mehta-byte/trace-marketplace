import "server-only";
import { loadServerConfig } from "@tm/config/server";
import { openDb, type Db } from "@tm/db";

// One database handle per server process (survives Next dev hot reloads).
const globalForDb = globalThis as unknown as { __tmDb?: Db };

export function getConfig() {
  return loadServerConfig();
}

export function getDb(): Db {
  if (!globalForDb.__tmDb) {
    globalForDb.__tmDb = openDb(getConfig().database.path);
  }
  return globalForDb.__tmDb;
}

export interface SystemStatus {
  database: { ok: boolean; path: string; tables: number; error?: string };
  sellerShare: number;
  traceSchemaVersion: number;
}
