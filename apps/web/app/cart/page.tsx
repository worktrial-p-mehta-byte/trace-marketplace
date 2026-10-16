import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureWelcomeCredits, getBuyerPreferences, viewCart, hasCurrentTerms } from "@tm/core";
import type { LicenseScope } from "@tm/schema";
import { money } from "@/lib/labels";
import { getBus, getConfig, getCurrentUser, getDb, refreshPrices } from "@/lib/server";
import { removeFromCartAction, reviewCartAction, topUpAction } from "./actions";

export const metadata: Metadata = { title: "Cart" };
export const dynamic = "force-dynamic";

const LICENSES: [LicenseScope, string, string][] = [
  ["research", "Research", "Study and analyse"],
  ["eval", "Evaluation", "Use in evals and benchmarks"],
  ["training", "Training", "Train or fine-tune models"],
];

export default async function CartPage({
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
        <h1 className="text-3xl font-bold tracking-tight">Cart</h1>
        <p className="mt-4 text-ink-2">
          {user.email} is a seller account. Buying needs a buyer account.
        </p>
      </main>
    );
  } // Buying needs the current terms; accounts from before them accept first.
  if (!hasCurrentTerms(user)) redirect("/onboarding");

  const config = getConfig();
  ensureWelcomeCredits(getDb(), config, user.buyerOrgId);
  refreshPrices();
  // The licence in the link, else the one the buyer said they need.
  const preferred = getBuyerPreferences(getDb(), user.buyerOrgId)?.license ?? "research";
  const license = (LICENSES.some(([k]) => k === p.license) ? p.license : preferred) as LicenseScope;
  const cart = viewCart(getDb(), { config, bus: getBus() }, user, license);
  const buyable = cart.lines.filter((l) => !l.excluded);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Cart</h1>
      <p className="mt-2 text-ink-2">
        Credits: <strong className="text-ink">{money(cart.balanceCents)}</strong>{" "}
        <span className="text-ink-3">(demo credits; the only simulated step)</span>
      </p>
      {p.error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-brick/40 bg-brick/5 px-4 py-3 text-brick"
        >
          {p.error}
        </p>
      )}

      {cart.lines.length === 0 ? (
        <div className="mt-8 rounded-lg border border-rule bg-surface p-8">
          <p className="text-ink-2">Your cart is empty.</p>
          <Link href="/traces" className="btn-quiet mt-4">
            Browse traces
          </Link>
        </div>
      ) : (
        <>
          <form className="mt-6 flex flex-wrap gap-2" action="/cart" aria-label="Licence">
            {LICENSES.map(([k, name, body]) => (
              <button
                key={k}
                name="license"
                value={k}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  license === k
                    ? "border-ink bg-ink text-paper"
                    : "border-rule text-ink-2 hover:text-ink"
                }`}
                aria-pressed={license === k}
              >
                <span className="block font-semibold">{name}</span>
                <span className="block text-xs opacity-80">{body}</span>
              </button>
            ))}
          </form>
          <ul className="mt-6 divide-y divide-rule border-y border-rule" aria-label="Cart items">
            {cart.lines.map((l) => (
              <li key={l.listingId} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/traces/${l.listingId}`}
                    className="block truncate font-semibold hover:text-cobalt"
                  >
                    {l.title ?? "Untitled session"}
                  </Link>
                  {l.excluded && (
                    <span className="text-sm text-ink-3">
                      {l.excluded === "already_licensed"
                        ? "You already hold this licence"
                        : l.excluded === "own_listing"
                          ? "Your own trace"
                          : l.excluded === "license_not_offered"
                            ? "Not offered under this licence"
                            : "No longer for sale"}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {!l.excluded && <span className="font-semibold">{money(l.priceCents)}</span>}
                  <form action={removeFromCartAction}>
                    <input type="hidden" name="listingId" value={l.listingId} />
                    <input type="hidden" name="license" value={license} />
                    <button className="text-sm text-ink-3 hover:text-brick">Remove</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p className="text-lg">
              Total, {LICENSES.find(([k]) => k === license)![1].toLowerCase()} licence:{" "}
              <strong>{money(cart.totalCents)}</strong>{" "}
              <span className="text-sm text-ink-3">at today&apos;s prices</span>
            </p>
            <form action={reviewCartAction}>
              <input type="hidden" name="license" value={license} />
              <button className="btn" disabled={!buyable.length}>
                Review order
              </button>
            </form>
          </div>
        </>
      )}
      <form action={topUpAction} className="mt-10">
        <input type="hidden" name="back" value={`/cart?license=${license}`} />
        <button className="btn-quiet text-sm">
          Add {money(config.checkout.topUpCents)} demo credits
        </button>
      </form>
    </main>
  );
}
