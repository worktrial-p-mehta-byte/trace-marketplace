import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getReceipt } from "@tm/core";
import { money } from "@/lib/labels";
import { getCurrentUser, getDb } from "@/lib/server";

export const metadata: Metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

const NAMES = { research: "Research", eval: "Evaluation", training: "Training" };

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.buyerOrgId) redirect("/cart");
  const { orderId } = await params;
  const p = await searchParams;
  const r = getReceipt(getDb(), user, orderId);
  if (!r) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/orders" className="text-sm font-semibold text-cobalt">
        ← Orders
      </Link>
      {p.paid && (
        <p role="status" className="mt-4 rounded-md border border-moss/40 bg-moss/5 px-4 py-3">
          Paid. The licences are yours and the traces are ready to download.
        </p>
      )}
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Receipt</h1>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">Order</dt>
          <dd className="font-mono">{r.orderId}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Date</dt>
          <dd>{r.createdAt.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Licence</dt>
          <dd>{NAMES[r.license]}, non-exclusive</dd>
        </div>
        <div>
          <dt className="text-ink-3">Status</dt>
          <dd className="capitalize">{r.status}</dd>
        </div>
      </dl>
      <table className="mt-6 w-full text-sm" aria-label="Order lines">
        <tbody>
          {r.lines.map((l) => (
            <tr key={l.listingId} className="border-t border-rule">
              <td className="py-2 pr-4">
                <Link href={`/traces/${l.listingId}`} className="hover:text-cobalt">
                  {l.title ?? "Untitled session"}
                </Link>
              </td>
              <td className="py-2 pr-4">
                <a href={`/api/listings/${l.listingId}/download`} className="text-cobalt">
                  Download
                </a>
              </td>
              <td className="py-2 text-right font-semibold">{money(l.priceCents)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink">
            <td className="py-2 pr-4 font-semibold" colSpan={2}>
              Paid with demo credits
            </td>
            <td className="py-2 text-right text-lg font-bold">{money(r.totalCents)}</td>
          </tr>
        </tbody>
      </table>
      {r.transactionId && (
        <p className="mt-4 text-xs text-ink-3">Ledger posting {r.transactionId}</p>
      )}
    </main>
  );
}
