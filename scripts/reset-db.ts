import { existsSync, rmSync } from "node:fs";
import { loadServerConfig } from "@tm/config/server";

// Deletes the local SQLite database (and its WAL files). Run `pnpm db:reset`
// to delete and re-create it.
const { path } = loadServerConfig().database;
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  const file = path + suffix;
  if (existsSync(file)) rmSync(file);
}
console.log(`Removed ${path}`);
