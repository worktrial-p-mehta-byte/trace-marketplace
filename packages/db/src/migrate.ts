import { loadServerConfig } from "@tm/config/server";
import { openDb, pendingMigrations, runMigrations } from "./client";

const config = loadServerConfig();
const db = openDb(config.database.path);
const pending = pendingMigrations(db);
runMigrations(db);
db.$client.close();
console.log(
  `Database ready at ${config.database.path}` +
    (pending.length ? ` (applied ${pending.join(", ")})` : ""),
);
