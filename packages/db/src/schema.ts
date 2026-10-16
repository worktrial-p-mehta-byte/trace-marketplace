import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Every table the full product needs exists from v0, even where v0 only
 * stubs the flow (bounties, orders). Conventions:
 * - ids are text (prefixed random ids)
 * - money is integer cents
 * - timestamps are integer milliseconds since epoch
 * - JSON columns hold structured data that is not queried directly
 */

const id = () => text("id").primaryKey();
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

// ---------------------------------------------------------------- accounts

export const buyerOrgs = sqliteTable("buyer_orgs", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["seller", "buyer", "both", "admin"] }).notNull(),
    buyerOrgId: text("buyer_org_id").references(() => buyerOrgs.id),
    /** Version of the data terms the user accepted at onboarding. */
    termsAcceptedVersion: text("terms_accepted_version"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const authSessions = sqliteTable("auth_sessions", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- supply

export const traces = sqliteTable(
  "traces",
  {
    id: id(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => users.id),
    schemaVersion: integer("schema_version").notNull(),
    source: text("source", { enum: ["real", "staged", "synthetic"] }).notNull(),
    title: text("title"),
    harness: text("harness").notNull(),
    model: text("model").notNull(),
    language: text("language"),
    framework: text("framework"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }).notNull(),
    turnCount: integer("turn_count").notNull(),
    toolCallCount: integer("tool_call_count").notNull(),
    /** Hash of the scrubbed content, for deduplication across sellers. */
    contentHash: text("content_hash").notNull(),
    /** Where the scrubbed trace JSON lives (BlobStore key). */
    blobKey: text("blob_key").notNull(),
    redactionCount: integer("redaction_count").notNull().default(0),
    redactionDensity: real("redaction_density").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("traces_seller_idx").on(t.sellerId),
    index("traces_hash_idx").on(t.contentHash),
    index("traces_facets_idx").on(t.language, t.framework, t.model),
  ],
);

/** Consent ledger: append-only record of every sharing decision. */
export const consents = sqliteTable(
  "consents",
  {
    id: id(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id),
    sellerId: text("seller_id")
      .notNull()
      .references(() => users.id),
    tier: integer("tier").notNull(),
    scope: text("scope", { enum: ["session", "repo"] }).notNull(),
    scopeRef: text("scope_ref"),
    termsVersion: text("terms_version").notNull(),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("consents_trace_idx").on(t.traceId)],
);

export const assets = sqliteTable(
  "assets",
  {
    id: id(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id),
    kind: text("kind", {
      enum: ["scrubbed_trace", "labels", "signals", "preference_pairs", "task_bundle"],
    }).notNull(),
    blobKey: text("blob_key"),
    data: text("data", { mode: "json" }),
    createdAt: createdAt(),
  },
  (t) => [index("assets_trace_idx").on(t.traceId)],
);

export const labels = sqliteTable(
  "labels",
  {
    id: id(),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id),
    kind: text("kind", { enum: ["failure", "outcome", "signal", "domain"] }).notNull(),
    code: text("code").notNull(),
    confidence: real("confidence").notNull(),
    source: text("source", { enum: ["heuristic", "model", "human"] }).notNull(),
    evidence: text("evidence", { mode: "json" }).$type<number[]>(),
    createdAt: createdAt(),
  },
  (t) => [index("labels_trace_idx").on(t.traceId), index("labels_code_idx").on(t.code)],
);

/** Pricing traits extracted from a trace (inputs to the pricing policy). */
export const traceTraits = sqliteTable("trace_traits", {
  traceId: text("trace_id")
    .primaryKey()
    .references(() => traces.id),
  data: text("data", { mode: "json" }).notNull(),
  /** Rarity key: language|framework|failure category|model. */
  comboKey: text("combo_key").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- catalog & pricing

export const listings = sqliteTable(
  "listings",
  {
    id: id(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    traceId: text("trace_id")
      .notNull()
      .references(() => traces.id),
    tier: integer("tier").notNull(),
    status: text("status", { enum: ["active", "delisted"] }).notNull(),
    pricePolicy: text("price_policy").notNull().default("trait-v1"),
    allowedLicenses: text("allowed_licenses", { mode: "json" }).$type<string[]>().notNull(),
    currentPriceCents: integer("current_price_cents"),
    priceUpdatedAt: integer("price_updated_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("listings_status_idx").on(t.status), index("listings_trace_idx").on(t.traceId)],
);

export const priceSnapshots = sqliteTable(
  "price_snapshots",
  {
    id: id(),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    priceCents: integer("price_cents").notNull(),
    /** Factor values (B, Q, R, F, X, D, T) at the time of pricing. */
    factors: text("factors", { mode: "json" }).notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("price_snapshots_listing_idx").on(t.listingId, t.createdAt)],
);

export const demandSignals = sqliteTable(
  "demand_signals",
  {
    id: id(),
    kind: text("kind", { enum: ["search", "view", "save", "bounty"] }).notNull(),
    buyerOrgId: text("buyer_org_id").references(() => buyerOrgs.id),
    /** Matching criteria, e.g. { language, framework, failure }. */
    criteria: text("criteria", { mode: "json" }).notNull(),
    weight: real("weight").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [index("demand_signals_created_idx").on(t.createdAt)],
);

// ---------------------------------------------------------------- buying

export const collections = sqliteTable("collections", {
  id: id(),
  buyerOrgId: text("buyer_org_id")
    .notNull()
    .references(() => buyerOrgs.id),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["static", "query"] }).notNull(),
  query: text("query", { mode: "json" }),
  createdAt: createdAt(),
});

export const collectionItems = sqliteTable(
  "collection_items",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.listingId] })],
);

export const collectionSnapshots = sqliteTable("collection_snapshots", {
  id: id(),
  collectionId: text("collection_id")
    .notNull()
    .references(() => collections.id),
  version: integer("version").notNull(),
  listingIds: text("listing_ids", { mode: "json" }).$type<string[]>().notNull(),
  createdAt: createdAt(),
});

export const quotes = sqliteTable("quotes", {
  id: id(),
  buyerOrgId: text("buyer_org_id")
    .notNull()
    .references(() => buyerOrgs.id),
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => collectionSnapshots.id),
  license: text("license", { enum: ["research", "eval", "training"] }).notNull(),
  totalCents: integer("total_cents").notNull(),
  breakdown: text("breakdown", { mode: "json" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

export const orders = sqliteTable("orders", {
  id: id(),
  quoteId: text("quote_id")
    .notNull()
    .references(() => quotes.id),
  buyerOrgId: text("buyer_org_id")
    .notNull()
    .references(() => buyerOrgs.id),
  status: text("status", { enum: ["pending", "paid", "refunded"] }).notNull(),
  totalCents: integer("total_cents").notNull(),
  createdAt: createdAt(),
});

export const orderLines = sqliteTable("order_lines", {
  id: id(),
  orderId: text("order_id")
    .notNull()
    .references(() => orders.id),
  listingId: text("listing_id")
    .notNull()
    .references(() => listings.id),
  priceCents: integer("price_cents").notNull(),
  /** Seller share in force when sold, so config changes never rewrite history. */
  sellerShareRate: real("seller_share_rate").notNull(),
  createdAt: createdAt(),
});

export const licenses = sqliteTable("licenses", {
  id: id(),
  orderLineId: text("order_line_id")
    .notNull()
    .references(() => orderLines.id),
  scope: text("scope", { enum: ["research", "eval", "training"] }).notNull(),
  exclusive: integer("exclusive", { mode: "boolean" }).notNull().default(false),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }),
});

export const entitlements = sqliteTable(
  "entitlements",
  {
    id: id(),
    buyerOrgId: text("buyer_org_id")
      .notNull()
      .references(() => buyerOrgs.id),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id),
    licenseId: text("license_id")
      .notNull()
      .references(() => licenses.id),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("entitlements_buyer_idx").on(t.buyerOrgId, t.assetId)],
);

// ---------------------------------------------------------------- money

/** Double-entry ledger. Every transaction's entries sum to zero. */
export const ledgerTransactions = sqliteTable("ledger_transactions", {
  id: id(),
  kind: text("kind").notNull(), // e.g. "credit_grant", "sale", "bounty_escrow", "payout"
  refType: text("ref_type"),
  refId: text("ref_id"),
  createdAt: createdAt(),
});

export const ledgerEntries = sqliteTable(
  "ledger_entries",
  {
    id: id(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    /** Account key, e.g. "buyer:<orgId>", "seller:<userId>", "platform:fees", "escrow:<bountyId>". */
    account: text("account").notNull(),
    /** Signed cents: positive = credit to the account, negative = debit. */
    amountCents: integer("amount_cents").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_entries_account_idx").on(t.account)],
);

// ---------------------------------------------------------------- bounties

export const bounties = sqliteTable("bounties", {
  id: id(),
  buyerOrgId: text("buyer_org_id")
    .notNull()
    .references(() => buyerOrgs.id),
  title: text("title").notNull(),
  spec: text("spec", { mode: "json" }).notNull(),
  perTraceCents: integer("per_trace_cents").notNull(),
  quantity: integer("quantity").notNull(),
  status: text("status", { enum: ["open", "filled", "closed"] }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const bountySubmissions = sqliteTable("bounty_submissions", {
  id: id(),
  bountyId: text("bounty_id")
    .notNull()
    .references(() => bounties.id),
  traceId: text("trace_id")
    .notNull()
    .references(() => traces.id),
  sellerId: text("seller_id")
    .notNull()
    .references(() => users.id),
  status: text("status", { enum: ["submitted", "accepted", "rejected"] }).notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- events

/** Outbox-style event log. v0 consumers poll it in-process; later it feeds a queue. */
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("events_type_idx").on(t.type)],
);

/** Each consumer's position in the event log. */
export const eventCursors = sqliteTable("event_cursors", {
  consumer: text("consumer").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});
