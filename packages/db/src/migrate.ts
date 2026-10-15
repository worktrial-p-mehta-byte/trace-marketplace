import { loadServerConfig } from "@tm/config/server";
import { openDb, runMigrations } from "./client";

const config = loadServerConfig();
const db = openDb(config.database.path);
runMigrations(db);
db.$client.close();
console.log(`Database ready at ${config.database.path}`);
