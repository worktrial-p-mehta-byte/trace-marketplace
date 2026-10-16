import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canSell, getBuyerPreferences, recommendFor, suggestedCampaign } from "@tm/core";
import { DOMAIN_NAMES, FAILURE_DESCRIPTIONS, FAILURE_NAMES, money } from "@/lib/labels";
import { getConfig, getCurrentUser, getDb, getSearch } from "@/lib/server";
import { savePreferencesAction } from "./actions";

export const metadata: Metadata = { title: "What do you need?" };
export const dynamic = "force-dynamic";

const LICENSES: [string, string, string][] = [
  ["research", "Study it", "Research licence: analyse and learn from the sessions"],
  ["eval", "Evaluate models", "Evaluation licence: use in evals and benchmarks"],
  ["training", "Train models", "Training licence: train or fine-tune on them"],
];
const FAILURES = [
  "user_correction",
  "retry_loop",
  "test_tampering",
  "tool_rejected",
  "user_interrupt",
  "tool_error",
];

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.buyerOrgId) redirect("/share");
  const p = await searchParams;
  const prefs = getBuyerPreferences(getDb(), user.buyerOrgId);

  if (p.done && prefs) {
    const picks = await recommendFor(
      getDb(),
      { config: getConfig(), search: getSearch() },
      prefs,
      6,
      user.buyerOrgId,
    );
    const c = suggestedCampaign(prefs);
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Picked for you</h1>
        <p className="mt-2 text-ink-2">
          From {prefs.domains.map((d) => DOMAIN_NAMES[d]).join(", ")}
          {prefs.failures.length > 0 &&
            `, with ${prefs.failures.map((f) => FAILURE_NAMES[f]?.toLowerCase()).join(" or ")} first`}
          . The catalog keeps these at the top for you.
        </p>
        {picks.length === 0 ? (
          <p className="mt-6 text-ink-2">Nothing listed in these domains yet.</p>
        ) : (
          <ul
            className="mt-6 divide-y divide-rule border-y border-rule"
            aria-label="Picked for you"
          >
            {picks.map((i) => (
              <li key={i.listingId}>
                <Link
                  href={`/traces/${i.listingId}`}
                  className="flex justify-between gap-4 py-3 hover:text-cobalt"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {i.title ?? "Signals-only session"}
                    </span>
                    <span className="text-sm text-ink-3">
                      {DOMAIN_NAMES[i.domain]} ·{" "}
                      {i.failures.map((f) => FAILURE_NAMES[f]).join(", ") || "no failures"}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold">{money(i.priceCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-8 rounded-lg border border-rule bg-surface p-5">
          <h2 className="font-semibold">Want them as they arrive?</h2>
          <p className="mt-1 text-sm text-ink-2">
            Start a campaign and every new “{c.describe}” session at up to ${c.maxPrice} is bought
            for you the moment a seller lists it.
          </p>
          <Link
            href={`/campaigns?describe=${encodeURIComponent(c.describe)}&maxPrice=${c.maxPrice}&license=${c.license}`}
            className="btn mt-3"
          >
            Set up a campaign
          </Link>
          <Link href="/traces" className="btn-quiet mt-3 ml-2">
            Browse everything
          </Link>
          {canSell(user) && (
            <Link href="/share" className="btn-quiet mt-3 ml-2">
              Share your sessions
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm font-semibold text-ink-3">Welcome, {user.displayName}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">What do you need?</h1>
      <p className="mt-2 text-ink-2">
        Four quick questions. The answers pick traces for you and tell sellers what is wanted. You
        can change them any time.
      </p>
      {p.error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-brick/40 bg-brick/5 px-4 py-3 text-brick"
        >
          {p.error}
        </p>
      )}
      <form action={savePreferencesAction} className="mt-8 space-y-8">
        <fieldset>
          <legend className="font-semibold">1. Which domains do you train or evaluate on?</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(DOMAIN_NAMES)
              .filter(([k]) => k !== "unknown")
              .map(([k, name]) => (
                <label
                  key={k}
                  className="flex items-center gap-2 rounded-full border border-rule px-3 py-1.5 text-sm has-[:checked]:border-cobalt has-[:checked]:bg-cobalt/10"
                >
                  <input
                    type="checkbox"
                    name="domain"
                    value={k}
                    defaultChecked={prefs?.domains.includes(k)}
                  />
                  {name}
                </label>
              ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-semibold">2. Which agent behaviour matters most?</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {FAILURES.map((f) => (
              <label key={f} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="failure"
                  value={f}
                  className="mt-1"
                  defaultChecked={prefs?.failures.includes(f)}
                />
                <span>
                  <span className="font-semibold">{FAILURE_NAMES[f]}</span>
                  <span className="block text-ink-3">{FAILURE_DESCRIPTIONS[f]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-semibold">3. How will you use the data?</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {LICENSES.map(([k, name, body]) => (
              <label
                key={k}
                className="rounded-md border border-rule p-3 text-sm has-[:checked]:border-cobalt has-[:checked]:bg-cobalt/10"
              >
                <input
                  type="radio"
                  name="license"
                  value={k}
                  defaultChecked={(prefs?.license ?? "research") === k}
                />{" "}
                <span className="font-semibold">{name}</span>
                <span className="block text-ink-3">{body}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-semibold">4. Content and budget</legend>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="content" value="1" defaultChecked={prefs?.contentNeeded} />
            I need the full content (open-source sessions only), not just the session&apos;s shape
          </label>
          <label className="mt-3 block text-sm">
            <span className="font-semibold">Typical budget per trace ($, optional)</span>
            <input
              name="maxPrice"
              type="number"
              min="0"
              step="0.5"
              defaultValue={prefs?.maxPriceCents ? (prefs.maxPriceCents / 100).toFixed(2) : ""}
              className="field mt-1.5 !w-32"
            />
          </label>
        </fieldset>
        <button className="btn">Show me traces</button>
      </form>
    </main>
  );
}
