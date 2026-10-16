import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listSellerTraces, sellerEarnings } from "@tm/core";
import { WithdrawButton } from "@/components/WithdrawButton";
import { getConfig, getCurrentUser, getDb } from "@/lib/server";

export const metadata: Metadata = { title: "My traces" };

export const dynamic = "force-dynamic";

const money = (c: number | null) => (c === null ? "—" : `$${(c / 100).toFixed(2)}`);

export default async function MyTracesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const rows = listSellerTraces(getDb(), user.id, getConfig());
  const active = rows.filter((r) => r.status === "active");
  const perSale = active.reduce((s, r) => s + (r.sellerCents ?? 0), 0);
  const earned = sellerEarnings(getDb(), user.id);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My traces</h1>
          {rows.length > 0 && (
            <p className="mt-2 text-ink-2">
              {active.length === 0 ? (
                "Nothing on sale right now. Withdrawn sessions stay listed here for your records."
              ) : (
                <>
                  {active.length} on sale. One sale of each would earn you{" "}
                  <strong className="price text-ink">{money(perSale)}</strong> at today&apos;s
                  prices.
                </>
              )}
            </p>
          )}
          {earned.sales > 0 && (
            <p className="mt-1 text-ink-2" aria-label="Earnings">
              {earned.sales} licence{earned.sales === 1 ? "" : "s"} sold so far; you have earned{" "}
              <strong className="text-ink">{money(earned.balanceCents)}</strong>.
            </p>
          )}
        </div>
        <Link href="/share" className="btn">
          Share more sessions
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-10 rounded-lg border border-rule bg-surface p-8">
          <h2 className="text-lg font-semibold">You haven&apos;t shared any sessions yet</h2>
          <p className="mt-2 text-ink-2">
            Pick a few Claude Code sessions to see what they are worth.
          </p>
          <Link href="/share" className="btn mt-5">
            Share your first session
          </Link>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-rule bg-surface">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-rule text-ink-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Session</th>
                <th className="px-4 py-3 font-semibold">Shared as</th>
                <th className="px-4 py-3 text-right font-semibold">Price</th>
                <th className="px-4 py-3 text-right font-semibold">You earn</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {rows.map((r) => (
                <tr key={r.traceId} className={r.status === "delisted" ? "text-ink-3" : ""}>
                  <td className="max-w-xs px-4 py-3">
                    <Link
                      href={`/traces/${r.listingId}`}
                      className="block truncate font-semibold hover:text-cobalt"
                    >
                      {r.title ?? `Session from ${r.startedAt.toLocaleDateString()}`}
                    </Link>
                    <span className="text-xs text-ink-3">
                      {r.language ?? "Unknown language"}, {r.turns} turns
                      {r.labels.length
                        ? `, ${r.labels.map((l) => l.replace(/_/g, " ")).join(", ")}`
                        : ""}
                    </span>
                    {r.listingId && (
                      <Link
                        href={`/traces/${r.listingId}/explain`}
                        className="block text-xs font-semibold text-cobalt"
                      >
                        Why these labels and this price?
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3">{r.tier === 0 ? "Open source" : "Signals only"}</td>
                  <td className="px-4 py-3 text-right font-semibold">{money(r.priceCents)}</td>
                  <td className="px-4 py-3 text-right">
                    {money(r.sellerCents)}
                    {r.listingId && earned.perListing.get(r.listingId) ? (
                      <span className="block text-xs text-moss">
                        sold {earned.perListing.get(r.listingId)}×
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === "active" ? (
                      <span className="font-semibold text-moss">On sale</span>
                    ) : (
                      <span>Withdrawn {r.revokedAt ? r.revokedAt.toLocaleDateString() : ""}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === "active" && <WithdrawButton traceId={r.traceId} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
