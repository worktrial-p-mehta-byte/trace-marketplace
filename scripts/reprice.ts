import { loadServerConfig } from "@tm/config/server";
import { createDbEventBus, repriceAll } from "@tm/core";
import { openDb } from "@tm/db";

// Reprice every active listing now. Prices also depend on time (freshness,
// the demand window), so production runs this on a schedule; the web app
// also refreshes on page loads once prices are older than
// pricing.refreshIntervalMinutes.
function main() {
  const config = loadServerConfig();
  const db = openDb(config.database.path);
  const r = repriceAll(db, { config, bus: createDbEventBus(db), reason: "scheduled refresh" });
  console.log(`Repriced ${r.repriced} listings; ${r.changed} changed.`);
}
main();
