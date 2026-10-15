/**
 * Interfaces for components that v0 implements locally and production
 * replaces with a hosted service. Callers depend only on these.
 */

/** v0: local filesystem under data/blobs. Later: S3 or R2. */
export interface BlobStore {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

export interface SearchQuery {
  text?: string;
  filters?: Record<string, string | string[] | undefined>;
  limit?: number;
  offset?: number;
}

/** v0: SQLite FTS5 plus SQL filters. Later: OpenSearch and a vector index. */
export interface SearchIndex {
  index(listingId: string, doc: Record<string, unknown>): Promise<void>;
  remove(listingId: string): Promise<void>;
  search(q: SearchQuery): Promise<{ ids: string[]; total: number }>;
}

/** v0: demo credits recorded in the ledger. Later: Stripe Checkout and Connect. */
export interface PaymentProvider {
  charge(buyerOrgId: string, amountCents: number, reference: string): Promise<{ ok: boolean }>;
  payout(sellerId: string, amountCents: number, reference: string): Promise<{ ok: boolean }>;
}
