import { eq } from "drizzle-orm";
import { loadServerConfig } from "@tm/config/server";
import {
  Accounts,
  createCampaign,
  createDbEventBus,
  createLocalBlobStore,
  createSqliteSearchIndex,
  ensureAccount,
  creditBalance,
  ensureWelcomeCredits,
  EventTypes,
  placeOrder,
  postTransaction,
  quoteCart,
  rebuildSearchIndex,
  recordDemandSignal,
  repriceAll,
  setInterest,
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
  const blobs = createLocalBlobStore(config.storage.blobPath);
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
    { domain: "medical" },
    { domain: "data_querying", failure: "tool_error" },
    { domain: "research" },
    { domain: "customer_support", failure: "user_correction" },
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

  // The buying side of the demo: the buyer team has its welcome credits and
  // a few past purchases (so sellers have sales and the trends board has
  // history), the demo seller follows two domains, and an open campaign is
  // buying medical evaluations where the agent was corrected, so sharing
  // demo session 10 sells it the moment it is listed.
  const checkoutDeps = { config, bus, now };
  ensureWelcomeCredits(db, config, buyer.buyerOrgId!);
  const pastBuys = db
    .select({ id: schema.listings.id, tier: schema.listings.tier, traits: schema.traceTraits.data })
    .from(schema.listings)
    .innerJoin(schema.traceTraits, eq(schema.traceTraits.traceId, schema.listings.traceId))
    .all()
    .filter((r) => r.tier === 0 && (r.traits as { domain?: string }).domain === "data_querying")
    .slice(0, 3)
    .map((r) => r.id);
  // Quoted first (in orders no longer than the configured limit), so the
  // seed knows exactly what its buying costs at today's prices.
  const perOrder = Math.max(1, config.checkout.maxOrderLines);
  const quotes = [];
  for (let i = 0; i < pastBuys.length; i += perOrder) {
    quotes.push(quoteCart(db, checkoutDeps, buyer, "research", pastBuys.slice(i, i + perOrder)));
  }
  const campaignInput = {
    title: "Clinical evaluations with corrections",
    describe: "medical evaluations where the agent was corrected",
    license: "research" as const,
    maxPriceCents: 4000,
    quantity: 6,
    days: 14,
  };
  // The seed's own buying is funded here, whatever the welcome credits are
  // configured to (they can be 0): the quoted purchases plus the campaign's
  // escrow (its max price times its quantity).
  const spend =
    quotes.reduce((sum, q) => sum + q.totalCents, 0) +
    campaignInput.maxPriceCents * campaignInput.quantity;
  const short = spend - creditBalance(db, buyer.buyerOrgId!);
  if (short > 0) {
    postTransaction(db, {
      kind: "credit_grant",
      refType: "seed",
      refId: buyer.buyerOrgId!,
      lines: [
        { account: Accounts.creditIssuer, amountCents: -short },
        { account: Accounts.buyer(buyer.buyerOrgId!), amountCents: short },
      ],
    });
  }
  for (const q of quotes) placeOrder(db, checkoutDeps, buyer, q.id);
  setInterest(db, demoSeller.id, "medical", true);
  setInterest(db, demoSeller.id, "data_querying", true);
  const campaign = createCampaign(db, checkoutDeps, buyer, campaignInput);
  // A second lab competes for the same sessions at a lower bid, so a new
  // medical session goes to auction: the $40 bid wins and pays $30. It is
  // funded with exactly its campaign's escrow.
  const rival = await ensureAccount(db, "buyer2@example.com", "buyer", "Second lab", DEMO_PASSWORD);
  const rivalInput = {
    title: "Medical corrections for our eval set",
    describe: "medical evaluations where the agent was corrected",
    license: "research" as const,
    maxPriceCents: 3000,
    quantity: 4,
    days: 14,
  };
  ensureWelcomeCredits(db, config, rival.buyerOrgId!);
  const rivalShort =
    rivalInput.maxPriceCents * rivalInput.quantity - creditBalance(db, rival.buyerOrgId!);
  if (rivalShort > 0) {
    postTransaction(db, {
      kind: "credit_grant",
      refType: "seed",
      refId: rival.buyerOrgId!,
      lines: [
        { account: Accounts.creditIssuer, amountCents: -rivalShort },
        { account: Accounts.buyer(rival.buyerOrgId!), amountCents: rivalShort },
      ],
    });
  }
  createCampaign(db, checkoutDeps, rival, rivalInput);

  bus.poll("pricing", () => {}, 1_000_000); // seed already priced everything
  bus.poll("search", () => {}, 1_000_000);
  bus.poll("campaigns", () => {}, 1_000_000); // the campaign already cleared the seeded market
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
  console.log(
    `Open campaign "${campaign.campaign.title}": bought ${campaign.filled} of ${campaign.campaign.quantity} so far.`,
  );
  console.log(
    `Demo logins (password "${DEMO_PASSWORD}"): seller@example.com, buyer@example.com, buyer2@example.com`,
  );
}
main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
