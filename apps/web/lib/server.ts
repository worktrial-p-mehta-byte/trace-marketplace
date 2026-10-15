import "server-only";
import { join } from "node:path";
import { cookies } from "next/headers";
import { findRepoRoot, loadServerConfig } from "@tm/config/server";
import {
  createDbEventBus,
  createLocalBlobStore,
  createSqliteSearchIndex,
  getUserBySession,
  runPricingConsumer,
  type BlobStore,
  type SearchIndex,
  type EventBus,
  type PublicUser,
} from "@tm/core";
import { openDb, type Db } from "@tm/db";

// One database handle per server process (survives Next dev hot reloads).
const g = globalThis as unknown as { __tmDb?: Db; __tmBlobs?: BlobStore };

export const SESSION_COOKIE = "tm_session";

export function getConfig() {
  return loadServerConfig();
}

export function getDb(): Db {
  if (!g.__tmDb) g.__tmDb = openDb(getConfig().database.path);
  return g.__tmDb;
}

export function getBus(): EventBus {
  return createDbEventBus(getDb());
}

export function getBlobs(): BlobStore {
  if (!g.__tmBlobs) g.__tmBlobs = createLocalBlobStore(join(findRepoRoot(), "data", "blobs"));
  return g.__tmBlobs;
}

export function getSearch(): SearchIndex {
  return createSqliteSearchIndex(getDb());
}

/**
 * Catch pricing up before showing prices: handle any pricing events still in
 * the outbox (e.g. after a failed run), else reprice if time alone has made
 * prices stale (freshness, demand window). Cheap when nothing is due.
 */
export function refreshPrices(): void {
  runPricingConsumer(getDb(), getBus(), { config: getConfig() });
}

export async function getCurrentUser(): Promise<PublicUser | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getUserBySession(getDb(), token);
}

export interface SystemStatus {
  database: { ok: boolean; path: string; tables: number; error?: string };
  sellerShare: number;
  traceSchemaVersion: number;
}
