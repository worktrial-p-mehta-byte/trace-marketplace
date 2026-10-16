import "server-only";
import { TRACE_SCHEMA_VERSION } from "@tm/schema";
import { databasePending, getConfig, getDb, type SystemStatus } from "./server";

export function getSystemStatus(): SystemStatus {
  const config = getConfig();
  let database: SystemStatus["database"] = { ok: false, path: config.database.path, tables: 0 };
  try {
    const row = getDb()
      .$client.prepare(
        "select count(*) as n from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'",
      )
      .get() as { n: number };
    database = { ok: row.n > 0, path: config.database.path, tables: row.n };
    const pending = databasePending(getDb());
    if (row.n === 0) database.error = "No tables yet. Run: pnpm db:migrate";
    else if (pending.length) {
      database.ok = false;
      database.error = `Missing migrations ${pending.join(", ")}. Run: pnpm db:migrate`;
    }
  } catch (err) {
    console.error("[status] database check failed", err);
    database.error = err instanceof Error ? err.message : String(err);
  }
  return {
    database,
    sellerShare: config.revenue.sellerShare,
    traceSchemaVersion: TRACE_SCHEMA_VERSION,
  };
}
