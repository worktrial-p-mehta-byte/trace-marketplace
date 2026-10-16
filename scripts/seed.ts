import { join } from "node:path";
import { eq } from "drizzle-orm";
import { findRepoRoot, loadServerConfig } from "@tm/config/server";
import {
  createDbEventBus,
  createLocalBlobStore,
  createSqliteSearchIndex,
  ensureAccount,
  EventTypes,
  rebuildSearchIndex,
  recordDemandSignal,
  repriceAll,
  shareTrace,
} from "@tm/core";
import { openDb, schema } from "@tm/db";
import { enrichTrace } from "@tm/enrich";
import { createRng, generateCatalog } from "@tm/synth";

/**
 * Fill the local database with a synthetic demo market.
 *
 *   pnpm seed                 # 200 traces, seed 42
 *   pnpm seed --count 400 --seed 7
 *
 * The catalog is replayed week by week over the last ~9 weeks: each week's
 * sessions are listed, a few buyer searches arrive, and prices are
 * recomputed, so every listing starts with a real price history.
 * All traces are marked synthetic. Demo logins (password "demo-password"):
 *   seller@example.com  (a seller with a few traces)
 *   buyer@example.com   (a buyer, for searching and posting bounties)
 */
const DEMO_PASSWORD = "demo-password";
// Exit codes the Docker entrypoint relies on (scripts/docker-entrypoint.sh).
const EXIT_NOT_EMPTY = 3; // the database already has traces: nothing to do
const EXIT_PARTIAL = 4; // an earlier seed stopped part-way: needs a reset
const WEEK = 7 * 86_400_000;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

async function main() {
  const count = arg("count", 200);
  const seed = arg("seed", 42);
  const config = loadServerConfig();
  const db = openDb(config.database.path);
  if (db.select().from(schema.traces).all().length > 0) {
    const demoUser = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "seller@example.com"))
      .get();
    const finished = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, EventTypes.DemoSeeded))
      .get();
    if (demoUser && !finished) {
      console.error("An earlier demo seed stopped part-way. Run `pnpm demo:reset` to start again.");
      process.exit(EXIT_PARTIAL);
    }
    console.error(
      "The database already has traces. Run `pnpm demo:reset` for a fresh demo market.",
    );
    process.exit(EXIT_NOT_EMPTY);
  }
  const bus = createDbEventBus(db);
  const blobs = createLocalBlobStore(join(findRepoRoot(), "data", "blobs"));
  const search = createSqliteSearchIndex(db);
  const now = new Date();
  const rng = createRng(seed + 1);

  const demoSeller = await ensureAccount(
    db,
    "seller@example.com",
    "seller",
    "Demo seller",
    DEMO_PASSWORD,
  );
  const buyer = await ensureAccount(db, "buyer@example.com", "buyer", "Demo buyer", DEMO_PASSWORD);
  const sellers = [demoSeller];
  for (let i = 1; i <= 8; i++) {
    sellers.push(
      await ensureAccount(
        db,
        `synthetic-seller-${i}@example.com`,
        "seller",
        `Synthetic seller ${i}`,
      ),
    );
  }

  const traces = generateCatalog(seed, count, now).sort((a, b) =>
    a.endedAt.localeCompare(b.endedAt),
  );
  const criteriaPool = [
    { language: "Rust" },
    { language: "Python", failure: "retry_loop" },
    { failure: "test_tampering" },
    { language: "TypeScript", framework: "React" },
    { language: "Terraform" },
    { failure: "user_correction" },
  ];

  let i = 0;
  let listed = 0;
  for (let t = now.getTime() - 9 * WEEK; t <= now.getTime(); t += WEEK) {
    const at = new Date(Math.min(t, now.getTime()));
    const deps = { config, bus, blobs, now: at };
    while (i < traces.length && Date.parse(traces[i]!.endedAt) <= at.getTime()) {
      const trace = traces[i]!;
      const tier = rng.chance(0.1) ? 1 : 0;
      const sellerId = rng.pick(sellers).id;
      const e = tier === 1 ? enrichTrace(trace) : undefined;
      await shareTrace(
        db,
        deps,
        { sellerId, trace, tier, clientTraits: e?.traits, clientLabels: e?.labels },
        { allowSynthetic: true, deferMarket: true },
      );
      i++;
      listed++;
    }
    for (let k = 0; k < rng.int(1, 3); k++) {
      recordDemandSignal(db, bus, {
        kind: "search",
        criteria: rng.pick(criteriaPool),
        weight: config.pricing.demand.signalWeights.search,
        buyerOrgId: buyer.buyerOrgId ?? undefined,
        now: at,
      });
    }
    repriceAll(db, { config, now: at, reason: "weekly market update", bus });
  }
  // Anything generated after the last weekly step.
  while (i < traces.length) {
    await shareTrace(
      db,
      { config, bus, blobs, now },
      { sellerId: rng.pick(sellers).id, trace: traces[i]!, tier: 0 },
      { allowSynthetic: true, deferMarket: true },
    );
    i++;
    listed++;
  }
  repriceAll(db, { config, now, reason: "seed complete", bus });
  bus.poll("pricing", () => {}, 1_000_000); // seed already priced everything
  bus.poll("search", () => {}, 1_000_000);
  const indexed = await rebuildSearchIndex(db, blobs, search);
  bus.emit(EventTypes.DemoSeeded, { traces: listed, seed });

  const prices = db
    .select({ p: schema.listings.currentPriceCents })
    .from(schema.listings)
    .all()
    .map((r) => r.p ?? 0);
  prices.sort((a, b) => a - b);
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  console.log(
    `Seeded ${listed} synthetic traces from ${sellers.length} sellers; ${indexed} indexed for search.`,
  );
  console.log(
    `Prices: lowest ${money(prices[0] ?? 0)}, median ${money(prices[Math.floor(prices.length / 2)] ?? 0)}, highest ${money(prices.at(-1) ?? 0)}.`,
  );
  console.log(`Demo logins (password "${DEMO_PASSWORD}"): seller@example.com, buyer@example.com`);
}
main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
