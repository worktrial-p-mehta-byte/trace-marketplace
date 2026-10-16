import { eq, sum } from "drizzle-orm";
import { newId, schema, type Db } from "@tm/db";

/** Account keys. Keep them in one place so reports can group by prefix. */
export const Accounts = {
  buyer: (orgId: string) => `buyer:${orgId}`,
  seller: (userId: string) => `seller:${userId}`,
  escrow: (bountyId: string) => `escrow:${bountyId}`,
  platformFees: "platform:fees",
  /** Source of demo credits in v0; a payment provider replaces it later. */
  creditIssuer: "platform:credit_issuer",
} as const;

export interface LedgerLine {
  account: string;
  amountCents: number;
}

export class UnbalancedTransactionError extends Error {}

export function assertBalanced(lines: LedgerLine[]): void {
  if (lines.length < 2)
    throw new UnbalancedTransactionError("A transaction needs at least two lines");
  for (const l of lines) {
    if (!Number.isInteger(l.amountCents)) {
      throw new UnbalancedTransactionError(`Amounts must be integer cents: ${l.amountCents}`);
    }
  }
  const total = lines.reduce((s, l) => s + l.amountCents, 0);
  if (total !== 0) throw new UnbalancedTransactionError(`Entries sum to ${total}, expected 0`);
}

/**
 * Write a balanced transaction atomically. Returns the transaction id. Pass
 * an open transaction as `db` to post as part of a larger unit of work.
 */
export function postTransaction(
  db: Pick<Db, "transaction">,
  tx: { kind: string; refType?: string; refId?: string; lines: LedgerLine[] },
): string {
  assertBalanced(tx.lines);
  const id = newId("ltx");
  db.transaction((t) => {
    t.insert(schema.ledgerTransactions)
      .values({ id, kind: tx.kind, refType: tx.refType, refId: tx.refId })
      .run();
    for (const l of tx.lines) {
      t.insert(schema.ledgerEntries)
        .values({
          id: newId("led"),
          transactionId: id,
          account: l.account,
          amountCents: l.amountCents,
        })
        .run();
    }
  });
  return id;
}

export function balanceOf(db: Db, account: string): number {
  const row = db
    .select({ total: sum(schema.ledgerEntries.amountCents) })
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.account, account))
    .get();
  return Number(row?.total ?? 0);
}

/** Sale split lives in @tm/pricing so the browser can show seller earnings too. */
export { splitSale } from "@tm/pricing";
