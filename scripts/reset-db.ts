import { existsSync, rmSync } from "node:fs";
import { loadServerConfig } from "@tm/config/server";

// Deletes the local SQLite database (and its WAL files) and the stored
// traces that belong to it. Run `pnpm db:reset` to delete and re-create it.
const config = loadServerConfig();
const { path } = config.database;
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const file = path + suffix;
  if (existsSync(file)) rmSync(file);
}
rmSync(config.storage.blobPath, { recursive: true, force: true });
console.log(`Removed ${path} and ${config.storage.blobPath}`);
