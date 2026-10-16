import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  creditBalance,
  ensureWelcomeCredits,
  expireCampaigns,
  listCampaigns,
  hasCurrentTerms,
} from "@tm/core";
import { DOMAIN_NAMES, FAILURE_NAMES, money } from "@/lib/labels";
import { getConfig, getCurrentUser, getDb } from "@/lib/server";
import { cancelCampaignAction, createCampaignAction } from "./actions";

export const metadata: Metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

const LICENSE_NAMES: Record<string, string> = {
  research: "Research",
  eval: "Evaluation",
  training: "Training",
};

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const p = await searchParams;
  if (!user.buyerOrgId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
        <p className="mt-4 text-ink-2">Campaigns are for buyer accounts.</p>
      </main>
    );
  }
  // Buying needs the current terms; accounts from before them accept first.
  if (!hasCurrentTerms(user)) redirect("/onboarding");
  ensureWelcomeCredits(getDb(), getConfig(), user.buyerOrgId);
  expireCampaigns(getDb(), {});
  const campaigns = listCampaigns(getDb(), user.buyerOrgId);
  const balance = creditBalance(getDb(), user.buyerOrgId);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
      <p className="mt-2 max-w-2xl text-ink-2">
        A standing bid: describe the traces you want, a maximum price and how many. The budget goes
        into escrow, and every matching trace at or under your price is bought for you at its list
        price, now and as sellers share new ones. Whatever is left comes back when it ends.
      </p>
      {p.error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-brick/40 bg-brick/5 px-4 py-3 text-brick"
        >
          {p.error}
        </p>
      )}
      {p.created && (
        <p role="status" className="mt-4 rounded-md border border-moss/40 bg-moss/5 px-4 py-3">
          Campaign started. It bought {p.filled ?? 0} matching trace{p.filled === "1" ? "" : "s"}{" "}
          straight away and will keep buying new ones.
        </p>
      )}

      <form
        action={createCampaignAction}
        className="mt-6 rounded-lg border border-rule bg-surface p-5"
        aria-label="New campaign"
      >
        <h2 className="text-lg font-semibold">New campaign</h2>
        <label className="mt-3 block">
          <span className="block text-sm font-semibold">What should it buy?</span>
          <input
            name="describe"
            defaultValue={p.describe}
            className="field mt-1.5"
            placeholder="e.g. medical evaluations where the agent was corrected"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="block">
            <span className="block text-sm font-semibold">Licence</span>
            <select
              name="license"
              className="field mt-1.5 !w-40"
              defaultValue={p.license && p.license in LICENSE_NAMES ? p.license : "research"}
            >
              {Object.entries(LICENSE_NAMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-semibold">Max per trace ($)</span>
            <input
              name="maxPrice"
              type="number"
              min="0.1"
              step="0.01"
              defaultValue={p.maxPrice ?? "15"}
              className="field mt-1.5 !w-32"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-semibold">How many</span>
            <input
              name="quantity"
              type="number"
              min="1"
              max="500"
              defaultValue="10"
              className="field mt-1.5 !w-28"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-semibold">Days</span>
            <input
              name="days"
              type="number"
              min="1"
              max="90"
              defaultValue="14"
              className="field mt-1.5 !w-24"
            />
          </label>
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Escrow is max price × how many. Your credits: {money(balance)}.
        </p>
        <button className="btn mt-4">Start campaign</button>
      </form>

      <section className="mt-8" aria-labelledby="yours">
        <h2 id="yours" className="text-lg font-semibold">
          Your campaigns
        </h2>
        {campaigns.length === 0 ? (
          <p className="mt-2 text-ink-2">None yet.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {campaigns.map((c) => (
              <li key={c.id} className="rounded-lg border border-rule bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-semibold">{c.title}</h3>
                  <span
                    className={`rounded px-2 py-0.5 text-sm font-semibold ${
                      c.status === "open" ? "bg-moss/10 text-moss" : "bg-ink/10 text-ink-2"
                    }`}
                  >
                    {c.status === "open"
                      ? `Open until ${c.expiresAt.toLocaleDateString()}`
                      : c.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-2">
                  {[
                    c.criteria.domain && DOMAIN_NAMES[c.criteria.domain],
                    c.criteria.language,
                    c.criteria.framework,
                    c.criteria.failure && FAILURE_NAMES[c.criteria.failure],
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  · {LICENSE_NAMES[c.license]} · up to {money(c.maxPriceCents)} each
                </p>
                <p className="mt-2 text-sm">
                  <strong>
                    {c.filled} of {c.quantity}
                  </strong>{" "}
                  bought · {money(c.spentCents)} spent · {money(c.escrowCents)} in escrow
                </p>
                {c.fills.length > 0 && (
                  <ul className="mt-2 divide-y divide-rule border-y border-rule text-sm">
                    {c.fills.slice(0, 8).map((f) => (
                      <li key={f.listingId} className="flex justify-between gap-3 py-1.5">
                        <Link
                          href={`/traces/${f.listingId}`}
                          className="truncate hover:text-cobalt"
                        >
                          {f.title ?? "Signals-only session"}
                        </Link>
                        <span className="shrink-0">
                          {money(f.priceCents)} ·{" "}
                          <a href={`/api/listings/${f.listingId}/download`} className="text-cobalt">
                            Download
                          </a>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {c.status === "open" && (
                  <form action={cancelCampaignAction} className="mt-3">
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn-quiet text-sm">End campaign and refund escrow</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
