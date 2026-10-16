import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { creditBalance, ensureWelcomeCredits, listOrders } from "@tm/core";
import { money } from "@/lib/labels";
import { getConfig, getCurrentUser, getDb } from "@/lib/server";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.buyerOrgId) redirect("/cart");
  ensureWelcomeCredits(getDb(), getConfig(), user.buyerOrgId);
  const orders = listOrders(getDb(), user.buyerOrgId);
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
      <p className="mt-2 text-ink-2">
        Credits:{" "}
        <strong className="text-ink">{money(creditBalance(getDb(), user.buyerOrgId))}</strong>
      </p>
      {orders.length === 0 ? (
        <p className="mt-6 text-ink-2">
          No orders yet.{" "}
          <Link href="/traces" className="text-cobalt">
            Browse traces
          </Link>
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-rule border-y border-rule">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/orders/${o.id}`}
                className="flex justify-between gap-4 py-3 hover:text-cobalt"
              >
                <span>
                  {o.createdAt.toLocaleString()} · {o.lines} trace{o.lines === 1 ? "" : "s"}
                </span>
                <span className="font-semibold">{money(o.totalCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
