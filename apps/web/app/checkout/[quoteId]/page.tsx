import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { creditBalance, ensureWelcomeCredits, getQuote, hasCurrentTerms } from "@tm/core";
import { payAction, topUpAction } from "@/app/cart/actions";
import { money } from "@/lib/labels";
import { getConfig, getCurrentUser, getDb } from "@/lib/server";

export const metadata: Metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

const NAMES = { research: "Research", eval: "Evaluation", training: "Training" };

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.buyerOrgId) redirect("/cart");
  // Buying needs the current terms; accounts from before them accept first.
  if (!hasCurrentTerms(user)) redirect("/onboarding");
  const { quoteId } = await params;
  const p = await searchParams;
  const q = getQuote(getDb(), user, quoteId);
  if (!q) notFound();
  if (q.orderId) redirect(`/orders/${q.orderId}`);
  ensureWelcomeCredits(getDb(), getConfig(), user.buyerOrgId);
  const balance = creditBalance(getDb(), user.buyerOrgId);
  const lines = q.lines.filter((l) => !l.excluded);
  const minutes = Math.max(0, Math.round((q.expiresAt.getTime() - Date.now()) / 60_000));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/cart" className="text-sm font-semibold text-cobalt">
        ← Cart
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Review and pay</h1>
      <p className="mt-2 text-ink-2">
        {NAMES[q.license]} licence ·{" "}
        {q.expired ? (
          <span className="text-brick">these prices have expired</span>
        ) : (
          <>
            prices held for {minutes} more minute{minutes === 1 ? "" : "s"}
          </>
        )}
      </p>
      {p.error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-brick/40 bg-brick/5 px-4 py-3 text-brick"
        >
          {p.error}
        </p>
      )}
      <table className="mt-6 w-full text-sm">
        <tbody>
          {lines.map((l) => (
            <tr key={l.listingId} className="border-t border-rule">
              <td className="py-2 pr-4">{l.title ?? "Untitled session"}</td>
              <td className="py-2 text-right font-semibold">{money(l.priceCents)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <td className="py-2 pr-4 font-semibold">Total</td>
            <td className="py-2 text-right text-lg font-bold">{money(q.totalCents)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-4 text-sm text-ink-2">
        Your credits: <strong className="text-ink">{money(balance)}</strong>. Sellers receive their
        share of each line and the platform its fee, in one balanced ledger posting.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {q.expired ? (
          <Link href="/cart" className="btn">
            Get current prices
          </Link>
        ) : balance < q.totalCents ? (
          <form action={topUpAction}>
            <input type="hidden" name="back" value={`/checkout/${q.id}`} />
            <button className="btn">Add demo credits</button>
          </form>
        ) : (
          <form action={payAction}>
            <input type="hidden" name="quoteId" value={q.id} />
            <button className="btn">Pay {money(q.totalCents)} with credits</button>
          </form>
        )}
      </div>
    </main>
  );
}
