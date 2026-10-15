import { join } from "node:path";
import { findRepoRoot, loadServerConfig } from "@tm/config/server";
import { createLocalBlobStore, createSqliteSearchIndex, rebuildSearchIndex } from "@tm/core";
import { openDb } from "@tm/db";

// Recreate the full-text search index from the database and stored traces.
// Safe to run any time; `pnpm bootstrap` runs it after migrations.
async function main() {
  const db = openDb(loadServerConfig().database.path);
  const n = await rebuildSearchIndex(
    db,
    createLocalBlobStore(join(findRepoRoot(), "data", "blobs")),
    createSqliteSearchIndex(db),
  );
  console.log(`Search index rebuilt: ${n} active listing${n === 1 ? "" : "s"}.`);
}
main();
