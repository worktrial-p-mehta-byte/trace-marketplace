import { existsSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { createLocalBlobStore } from "@tm/core";
import { openDb } from "@tm/db";

/** Blob keys the database at `dbPath` refers to (empty if it doesn't exist or has no tables yet). */
export function blobKeysOf(dbPath: string): string[] {
  if (!existsSync(dbPath)) return [];
  const db = openDb(dbPath);
  try {
    const rows = db.$client
      .prepare(
        "SELECT blob_key AS k FROM traces UNION SELECT blob_key FROM assets WHERE blob_key IS NOT NULL",
      )
      .all() as { k: string }[];
    return rows.map((r) => r.k);
  } catch {
    return []; // not migrated yet: nothing stored
  } finally {
    db.$client.close();
  }
}

/** Remove the folders a blob lived in, up to and including `root`, while they are empty. */
function pruneUpward(root: string, key: string): void {
  const top = resolve(root);
  let dir = dirname(resolve(top, key));
  const inside = (d: string) => d === top || d.startsWith(top + sep);
  while (inside(dir) && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    if (dir === top) break;
    dir = dirname(dir);
  }
}

/**
 * Delete a local database and only the stored traces it refers to.
 *
 * Deleting the whole blob folder is unsafe: BLOB_DIR may be shared with
 * another database (DATABASE_PATH changed without BLOB_DIR) or point
 * somewhere broad by mistake (BLOB_DIR=.). Only blobs listed in this
 * database are removed, through the blob store's own key-to-path check, then
 * the folders they leave empty. Anything else in the folder stays.
 */
export async function resetLocalData(dbPath: string, blobRoot: string) {
  const keys = blobKeysOf(dbPath);
  const blobs = createLocalBlobStore(blobRoot);
  for (const key of keys) await blobs.delete(key);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const file = dbPath + suffix;
    if (existsSync(file)) rmSync(file);
  }
  for (const key of keys) pruneUpward(blobRoot, key);
  return { blobsRemoved: keys.length, blobDirLeft: existsSync(blobRoot) };
}
